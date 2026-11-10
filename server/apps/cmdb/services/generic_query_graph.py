"""把通用查询的计数、数值聚合和一跳关系统计下推到图数据库。"""

from __future__ import annotations

from apps.cmdb.constants.constants import INSTANCE, INSTANCE_ASSOCIATION
from apps.cmdb.graph.drivers.graph_client import GraphClient
from apps.cmdb.graph.falkordb_format import FormatDBResult
from apps.cmdb.graph.format_type import ParameterCollector
from apps.cmdb.graph.validators import CQLValidator
from apps.cmdb.services.generic_query_limits import QUERY_TIMEOUT_MS
from apps.cmdb.services.instance import InstanceManage

_AGGREGATIONS = {
    "sum": "sum",
    "avg": "avg",
    "min": "min",
    "max": "max",
}


class GenericQueryGraphError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def count_by_attr(group_by_attr: str, params: list, permission_map: dict) -> dict:
    """图内 GROUP BY 计数，返回 {分组值: 数量}。"""
    CQLValidator.validate_field(group_by_attr)
    return InstanceManage.group_inst_count(
        group_by_attr=group_by_attr,
        permissions_map=permission_map,
        params=list(params or []),
    )


def aggregate_numeric(field: str, aggregation: str, params: list, permission_map: dict) -> dict:
    """图内对数值属性做 sum/avg/min/max，同时返回参与计数。"""
    agg = _AGGREGATIONS.get(str(aggregation or "").strip().lower())
    if agg is None:
        raise GenericQueryGraphError("聚合方式不受支持")
    validated = CQLValidator.validate_field(field)
    with GraphClient() as client:
        where, query_params = _where_clause(client, params, permission_map, alias="n")
        query = f"MATCH (n:{INSTANCE}) {where} " f"RETURN {agg}(n.{validated}) AS value, count(n) AS scanned"
        rows = _run(client, query, query_params)
    if not rows:
        return {"value": None, "scanned": 0}
    row = rows[0]
    return {"value": row.get("value"), "scanned": int(row.get("scanned") or 0)}


def query_one_hop(
    *,
    start_uuids: list[str],
    model_asst_id: str,
    direction: str,
    end_model_id: str,
    permission_map: dict,
    end_field: str | None = None,
    end_op: str | None = None,
    end_value=None,
) -> dict:
    """一跳关系统计。终点权限写进图查询，计数和结果上限都按过滤后的边计算。"""
    if direction not in {"out", "in"}:
        raise GenericQueryGraphError("关系方向不受支持")
    if not start_uuids:
        return {"pair_count": 0, "pairs": [], "groups": []}
    CQLValidator.validate_field("inst_uuid")
    # end_model_id、model_asst_id 只作为参数值，不拼进标识符位置。
    pattern = f"(s)-[e:{INSTANCE_ASSOCIATION}]->(t)" if direction == "out" else f"(s)<-[e:{INSTANCE_ASSOCIATION}]-(t)"
    where = [
        "s.inst_uuid IN $start_uuids",
        "e.model_asst_id = $model_asst_id",
        "t.model_id = $end_model_id",
    ]
    params = {
        "start_uuids": list(start_uuids),
        "model_asst_id": str(model_asst_id),
        "end_model_id": str(end_model_id),
    }
    if end_field not in (None, "") and end_value not in (None, ""):
        validated = CQLValidator.validate_field(end_field)
        op = str(end_op or "eq")
        if op == "eq":
            where.append(f"t.{validated} = $end_value")
        elif op == "contains":
            where.append(f"t.{validated} CONTAINS $end_value")
        else:
            raise GenericQueryGraphError("终点过滤运算符不受支持")
        params["end_value"] = end_value
    with GraphClient() as client:
        permission_sql, permission_params = _permission_clause(client, permission_map, alias="t")
        params.update(permission_params)
        where_sql = " AND ".join([*where, permission_sql])
        count_query = (
            f"MATCH {pattern} WHERE {where_sql} " "WITH DISTINCT s.inst_uuid AS start_uuid, t.inst_uuid AS end_uuid " "RETURN count(*) AS pair_count"
        )
        count_rows = _run(client, count_query, params)
        pair_count = int((count_rows[0].get("pair_count") if count_rows else 0) or 0)
        if pair_count == 0:
            return {"pair_count": 0, "pairs": [], "groups": []}
        from apps.cmdb.services.generic_query_limits import ONE_HOP_RESULT_MAX

        if pair_count > ONE_HOP_RESULT_MAX:
            return {"pair_count": pair_count, "pairs": None, "groups": None}
        group_query = (
            f"MATCH {pattern} "
            f"WHERE {where_sql} "
            "WITH DISTINCT s.inst_uuid AS start_uuid, s.inst_name AS start_name, "
            "t.inst_uuid AS end_uuid, t.inst_name AS end_name "
            "RETURN end_uuid, end_name, count(start_uuid) AS value"
        )
        pair_query = (
            f"MATCH {pattern} "
            f"WHERE {where_sql} "
            "WITH DISTINCT s.inst_uuid AS start_uuid, s.inst_name AS start_name, "
            "s.model_id AS start_model_id, t.inst_uuid AS end_uuid, "
            "t.inst_name AS end_name, t.model_id AS end_model_id "
            "RETURN start_uuid, start_name, start_model_id, end_uuid, end_name, end_model_id"
        )
        groups = _run(client, group_query, params)
        pairs = _run(client, pair_query, params)
    return {"pair_count": pair_count, "pairs": pairs, "groups": groups}


def _permission_clause(client, permission_map: dict, alias: str) -> tuple[str, dict]:
    """把实例权限写成图条件。权限范围为空时失败关闭，不退回全量终点。"""
    if not permission_map:
        raise GenericQueryGraphError("缺少权限范围，已拒绝查询")
    collector = ParameterCollector()
    permission = InstanceManage._build_format_permission_dict(permission_map or {}, "")
    permission_parts = []
    for organization_id, query_list in permission.items():
        org_params = [{"field": "organization", "type": "list[]", "value": [organization_id]}]
        org_str, _ignored = client.format_search_params(
            org_params,
            param_type="AND",
            param_collector=collector,
            alias=alias,
        )
        extra_str, _ignored = client.format_search_params(
            query_list or [],
            param_type="OR",
            param_collector=collector,
            alias=alias,
        )
        if org_str and extra_str:
            permission_parts.append(f"({org_str} AND {extra_str})")
        elif org_str:
            permission_parts.append(org_str)
    if not permission_parts:
        raise GenericQueryGraphError("缺少权限范围，已拒绝查询")
    joined = permission_parts[0] if len(permission_parts) == 1 else "(" + " OR ".join(permission_parts) + ")"
    return joined, collector.get_params()


def _where_clause(client, params: list, permission_map: dict, alias: str) -> tuple[str, dict]:
    collector = ParameterCollector()
    base, _query_params = client.format_search_params(
        list(params or []),
        param_type="AND",
        param_collector=collector,
        alias=alias,
    )
    permission = InstanceManage._build_format_permission_dict(permission_map or {}, "")
    permission_parts = []
    for organization_id, query_list in permission.items():
        org_params = [{"field": "organization", "type": "list[]", "value": [organization_id]}]
        org_str, _ignored = client.format_search_params(
            org_params,
            param_type="AND",
            param_collector=collector,
            alias=alias,
        )
        extra_str, _ignored = client.format_search_params(
            query_list or [],
            param_type="OR",
            param_collector=collector,
            alias=alias,
        )
        if org_str and extra_str:
            permission_parts.append(f"({org_str} AND {extra_str})")
        elif org_str:
            permission_parts.append(org_str)
    parts = []
    if base:
        parts.append(base)
    if permission_parts:
        joined = permission_parts[0] if len(permission_parts) == 1 else "(" + " OR ".join(permission_parts) + ")"
        parts.append(joined)
    if not parts:
        raise GenericQueryGraphError("缺少权限范围，已拒绝全量扫描")
    return "WHERE " + " AND ".join(parts), collector.get_params()


def _run(client, query: str, params: dict) -> list[dict]:
    if hasattr(client, "_execute_query"):
        result = client._execute_query(query, params=params, timeout=QUERY_TIMEOUT_MS)
        return _rows_from_falkor(result)
    session = getattr(client, "session", None)
    if session is None:
        raise GenericQueryGraphError("图数据库连接不可用")
    transaction = session.begin_transaction(timeout=QUERY_TIMEOUT_MS / 1000)
    try:
        cursor = transaction.run(query, params or {})
        rows = [record.data() for record in cursor]
        transaction.commit()
        return rows
    except Exception:
        transaction.rollback()
        raise


def _rows_from_falkor(result) -> list[dict]:
    formatted = FormatDBResult(result)
    rows = []
    for record in formatted.records or []:
        if formatted.headers and len(formatted.headers) == len(record):
            rows.append(dict(zip(formatted.headers, record)))
        elif isinstance(record, dict):
            rows.append(record)
    return rows

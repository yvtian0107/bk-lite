"""当前请求语言下的运营分析用户文案。

缺词条时回退调用方给出的中文原文，保证未切换语言时的响应不变。
"""

from __future__ import annotations

from django.utils import translation

from apps.core.utils.loader import LanguageLoader
from apps.operation_analysis.services.builtin_i18n import normalize_oa_language


def oa_message(message_key: str, default: str, /, **params: object) -> str:
    language = normalize_oa_language(translation.get_language())
    catalog = LanguageLoader("operation_analysis", language).translations or {}
    node: object = catalog
    for part in message_key.split("."):
        if not isinstance(node, dict) or part not in node:
            node = None
            break
        node = node[part]
    template = node if isinstance(node, str) and node else default
    if not params:
        return template
    return template.format(**params)

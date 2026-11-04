from django.db.models import Count
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.decorators.api_permission import HasPermission
from apps.core.utils.viewset_utils import AuthViewSet, user_group_id_set
from apps.operation_analysis.common.audit_log import get_response_name, log_ops_analysis_success
from apps.operation_analysis.models.carousel import CanvasCarousel
from apps.operation_analysis.serializers.carousel_serializers import (
    CanvasCarouselAppendSerializer,
    CanvasCarouselListSerializer,
    CanvasCarouselWriteSerializer,
)
from apps.operation_analysis.services.carousel import (
    append_carousel_item,
    copy_carousel,
    create_carousel,
    describe_carousel,
    normalize_group_list,
    update_carousel,
)
from apps.operation_analysis.views.view import BuiltinVisibleMixin
from config.drf.pagination import CustomPageNumberPagination


class CanvasCarouselViewSet(BuiltinVisibleMixin, AuthViewSet):
    """轮播列表。可见性按所属组织与当前组织的交集过滤。"""

    queryset = CanvasCarousel.objects.all()
    serializer_class = CanvasCarouselListSerializer
    ordering_fields = ["id"]
    ordering = ["-id"]
    pagination_class = CustomPageNumberPagination
    ORGANIZATION_FIELD = "groups"
    ORDERING_FIELD = "-id"

    def get_queryset(self):
        queryset = CanvasCarousel.objects.all()
        name = (self.request.query_params.get("name") or "").strip()
        if name:
            queryset = queryset.filter(name__icontains=name[:128])
        if self.action == "list":
            queryset = queryset.annotate(item_count=Count("items")).prefetch_related("items")
        else:
            queryset = queryset.prefetch_related("items")
        _current_team, _include_children, _org_field, org_query = self.filter_by_group(
            queryset,
            self.request,
            self.request.user,
        )
        return queryset.filter(org_query)

    def _detail_payload(self, carousel, *, playback: bool):
        carousel = CanvasCarousel.objects.prefetch_related("items").get(pk=carousel.pk)
        return describe_carousel(carousel, self.request, playback=playback)

    @HasPermission("view-View")
    def list(self, request, *args, **kwargs):
        return super().list(request, *args, **kwargs)

    @HasPermission("view-View")
    def retrieve(self, request, *args, **kwargs):
        carousel = self.get_object()
        return Response(self._detail_payload(carousel, playback=False))

    @HasPermission("view-View")
    @action(detail=True, methods=["get"])
    def playback(self, request, *args, **kwargs):
        carousel = self.get_object()
        return Response(self._detail_payload(carousel, playback=True))

    @HasPermission("view-AddChart")
    def create(self, request, *args, **kwargs):
        serializer = CanvasCarouselWriteSerializer(data=request.data, context=self.get_serializer_context())
        serializer.is_valid(raise_exception=True)
        groups = serializer.validated_data.get("groups") or []
        self._validate_org_field_permission(request, groups)
        carousel = create_carousel(request, serializer.validated_data)
        response = Response(self._detail_payload(carousel, playback=False), status=201)
        log_ops_analysis_success(
            request,
            response,
            "create",
            f"新增轮播列表: {get_response_name(response, carousel.name)}",
        )
        return response

    @HasPermission("view-EditChart")
    def update(self, request, *args, **kwargs):
        return self._save_update(request, partial=False)

    @HasPermission("view-EditChart")
    def partial_update(self, request, *args, **kwargs):
        return self._save_update(request, partial=True)

    def _save_update(self, request, *, partial: bool):
        carousel = self.get_object()
        serializer = CanvasCarouselWriteSerializer(
            instance=carousel,
            data=request.data,
            partial=partial,
            context=self.get_serializer_context(),
        )
        serializer.is_valid(raise_exception=True)
        if "groups" in serializer.validated_data:
            self._validate_org_field_permission(request, serializer.validated_data["groups"])
        updated = update_carousel(request, carousel, serializer.validated_data)
        response = Response(self._detail_payload(updated, playback=False))
        log_ops_analysis_success(
            request,
            response,
            "update",
            f"编辑轮播列表: {get_response_name(response, updated.name)}",
        )
        return response

    @HasPermission("view-DeleteChart")
    def destroy(self, request, *args, **kwargs):
        carousel = self.get_object()
        name = carousel.name
        response = super().destroy(request, *args, **kwargs)
        log_ops_analysis_success(request, response, "delete", f"删除轮播列表: {name}")
        return response

    @HasPermission("view-AddChart")
    @action(detail=True, methods=["post"])
    def copy(self, request, *args, **kwargs):
        source = self.get_object()
        groups = self._copy_groups(request, source)
        self._validate_org_field_permission(request, groups)
        copied = copy_carousel(request, source, groups)
        response = Response(self._detail_payload(copied, playback=False), status=201)
        log_ops_analysis_success(request, response, "create", f"复制轮播列表: {copied.name}")
        return response

    @HasPermission("view-EditChart")
    @action(detail=True, methods=["post"])
    def append(self, request, *args, **kwargs):
        carousel = self.get_object()
        serializer = CanvasCarouselAppendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        append_carousel_item(request, carousel, serializer.validated_data)
        response = Response(self._detail_payload(carousel, playback=False))
        log_ops_analysis_success(request, response, "update", f"编辑轮播列表: {carousel.name}")
        return response

    def _copy_groups(self, request, source):
        current_team = self._parse_current_team_cookie(request)
        source_groups = normalize_group_list(source.groups)
        user = request.user
        if getattr(user, "is_superuser", False):
            return source_groups or ([int(current_team)] if current_team else [])
        allowed = user_group_id_set(user)
        kept = [group_id for group_id in source_groups if group_id in allowed]
        if current_team and int(current_team) not in kept:
            kept.append(int(current_team))
        return kept or ([int(current_team)] if current_team else [])

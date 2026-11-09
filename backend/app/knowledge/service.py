from uuid import UUID, uuid4

from sqlalchemy import select

from app.courses import owned_by_id
from app.curriculum.models import Chapter, Section, StructureEvent, StructureVersion
from app.errors import AppError
from app.knowledge.models import KnowledgePoint
from app.models import now

CONTENT = ("title", "description", "learning_objectives", "importance", "mastery_criteria")


def conflict():
    return AppError("VERSION_CONFLICT", "知识点版本已变化，请重新加载并核对", 409)


async def owned_section(db, section_id, actor_id):
    # Lock order is always course, then version. Never acquire a section lock first.
    course_id = await db.scalar(
        select(Chapter.course_id).join(Section).where(Section.id == section_id)
    )
    if course_id is None:
        raise AppError("NOT_FOUND", "小节不存在", 404)
    course = await owned_by_id(db, course_id, actor_id)
    row = (
        await db.execute(
            select(Section, Chapter)
            .join(Chapter)
            .where(
                Section.id == section_id, Section.archived.is_(False), Chapter.archived.is_(False)
            )
        )
    ).first()
    if not row:
        raise AppError("NOT_FOUND", "小节不存在或已归档", 404)
    return course, row.Section, row.Chapter


async def points(db, section_id):
    return (
        await db.scalars(
            select(KnowledgePoint)
            .where(KnowledgePoint.section_id == section_id, KnowledgePoint.archived_at.is_(None))
            .order_by(KnowledgePoint.order_index, KnowledgePoint.id)
        )
    ).all()


def point_data(point):
    return {
        key: getattr(point, key)
        for key in ("id", "section_id", *CONTENT, "order_index", "status", "content_version_id")
    }


def version_data(version):
    return {
        key: getattr(version, key)
        for key in (
            "id",
            "section_id",
            "structure_type",
            "status",
            "revision",
            "base_course_revision",
            "applied_course_revision",
            "payload",
            "id_mapping",
            "source",
            "generation_run_id",
            "change_summary",
            "confirmed_at",
            "created_at",
        )
    }


async def owned_version(db, course_id, section_id, version_id):
    version = await db.scalar(
        select(StructureVersion)
        .where(
            StructureVersion.id == version_id,
            StructureVersion.course_id == course_id,
            StructureVersion.section_id == section_id,
            StructureVersion.structure_type == "KNOWLEDGE",
        )
        .with_for_update()
    )
    if not version:
        raise AppError("NOT_FOUND", "知识草稿不存在", 404)
    return version


async def changes(db, section_id, payload):
    existing = {str(p.id): p for p in await points(db, section_id)}
    retained = set()
    result = {"added": [], "modified": [], "archived": []}
    for index, item in enumerate(payload["knowledge_points"]):
        match = item["existing_knowledge_point_id"]
        if match is None:
            result["added"].append({"id": item["temp_id"], "title": item["title"]})
            continue
        if match not in existing or match in retained:
            raise AppError("INVALID_REFERENCE", "知识点匹配不属于当前小节的有效节点或重复")
        retained.add(match)
        old = existing[match]
        if any(getattr(old, key) != item[key] for key in CONTENT) or old.order_index != index:
            result["modified"].append(
                {
                    "id": match,
                    "title": item["title"],
                    "previous_title": old.title,
                    "review_mastery": any(
                        getattr(old, k) != item[k]
                        for k in ("description", "learning_objectives", "mastery_criteria")
                    ),
                }
            )
    result["archived"] = [
        {"id": key, "title": p.title} for key, p in existing.items() if key not in retained
    ]
    return result


async def latest_draft(db, section_id):
    return await db.scalar(
        select(StructureVersion)
        .where(
            StructureVersion.section_id == section_id,
            StructureVersion.structure_type == "KNOWLEDGE",
            StructureVersion.status == "DRAFT",
        )
        .order_by(StructureVersion.created_at.desc(), StructureVersion.id)
        .limit(1)
    )


def check_replacement(previous, replace_id, replace_revision):
    if previous is None:
        if replace_id is not None:
            raise conflict()
    elif previous.id != replace_id or previous.revision != replace_revision:
        raise AppError("DRAFT_EXISTS", "已有知识草稿，请核对后明确替换", 409)


async def new_draft(
    db,
    course,
    section_id,
    actor_id,
    payload,
    source=None,
    raw_output="",
    run_id=None,
    replace_id=None,
    replace_revision=None,
):
    summary = await changes(db, section_id, payload)
    previous = await latest_draft(db, section_id)
    check_replacement(previous, replace_id, replace_revision)
    if previous:
        previous.status = "SUPERSEDED"
        db.add(
            StructureEvent(version_id=previous.id, actor_id=actor_id, action="REPLACED", details={})
        )
    version = StructureVersion(
        user_id=actor_id,
        course_id=course.id,
        section_id=section_id,
        structure_type="KNOWLEDGE",
        base_course_revision=course.confirmed_revision,
        payload=payload,
        source=source or {"kind": "manual"},
        raw_output=raw_output,
        generation_run_id=run_id,
        change_summary=summary,
    )
    db.add(version)
    await db.flush()
    db.add(
        StructureEvent(
            version_id=version.id,
            actor_id=actor_id,
            action="CREATED",
            details={"base_course_revision": course.confirmed_revision},
        )
    )
    await db.commit()
    return version_data(version)


async def confirm(db, course, section_id, version, actor_id, revision, base, accept_archives):
    if version.applied_course_revision is not None:
        return {**version_data(version), "status": "CONFIRMED"}
    if (
        version.status != "DRAFT"
        or version.revision != revision
        or version.base_course_revision != base
        or course.confirmed_revision != base
    ):
        raise conflict()
    if version.payload.get("uncertain_items"):
        raise AppError("UNRESOLVED_ITEMS", "请核对所有不确定项并保存草稿", 409)
    summary = await changes(db, section_id, version.payload)
    if summary["archived"] and not accept_archives:
        raise AppError("ARCHIVE_CONFIRMATION_REQUIRED", "请核对并确认归档列出的知识点", 409)
    old = {str(p.id): p for p in await points(db, section_id)}
    mapping = {}
    for index, item in enumerate(version.payload["knowledge_points"]):
        point = old.get(item["existing_knowledge_point_id"])
        if point is None:
            point = KnowledgePoint(id=uuid4(), section_id=section_id, status="NOT_STARTED")
            db.add(point)
        mapping[item["temp_id"]] = str(point.id)
        for key in CONTENT:
            setattr(point, key, item[key])
        point.order_index, point.content_version_id = index, version.id
    for removed in summary["archived"]:
        old[removed["id"]].archived_at = now()
    previous = (
        await db.scalars(
            select(StructureVersion).where(
                StructureVersion.course_id == course.id,
                StructureVersion.section_id == section_id,
                StructureVersion.structure_type == "KNOWLEDGE",
                StructureVersion.status == "CONFIRMED",
            )
        )
    ).all()
    for item in previous:
        item.status = "SUPERSEDED"
        db.add(
            StructureEvent(
                version_id=item.id,
                actor_id=actor_id,
                action="SUPERSEDED",
                details={"replacement_id": str(version.id)},
            )
        )
    await db.flush()
    course.confirmed_revision += 1
    version.status = "CONFIRMED"
    version.applied_course_revision = course.confirmed_revision
    version.id_mapping, version.change_summary = mapping, summary
    version.confirmed_by, version.confirmed_at = actor_id, now()
    db.add(
        StructureEvent(
            version_id=version.id,
            actor_id=actor_id,
            action="CONFIRMED",
            details={"course_revision": course.confirmed_revision, **summary},
        )
    )
    await db.commit()
    return version_data(version)


async def curriculum_archives(db, course_id, removed_ids):
    """Query current knowledge affected by explicit directory removals, without mutation."""
    if not removed_ids:
        return []
    ids = [UUID(key) for key in removed_ids]
    return (
        await db.scalars(
            select(KnowledgePoint)
            .join(Section)
            .join(Chapter)
            .where(
                Chapter.course_id == course_id,
                KnowledgePoint.archived_at.is_(None),
                Section.id.in_(ids),
            )
            .order_by(KnowledgePoint.order_index, KnowledgePoint.id)
        )
    ).all()


async def archive_for_curriculum(db, course_id, removed_ids):
    # Caller owns course lock and transaction; committing belongs to directory confirmation.
    for point in await curriculum_archives(db, course_id, removed_ids):
        point.archived_at = now()

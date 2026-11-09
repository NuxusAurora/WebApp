from uuid import uuid4

from sqlalchemy import select

from app.curriculum.models import Chapter, Section, StructureEvent, StructureVersion
from app.errors import AppError
from app.knowledge.service import archive_for_curriculum, curriculum_archives
from app.models import now


def conflict():
    return AppError("VERSION_CONFLICT", "目录版本已变化，请重新加载并核对", 409)


async def nodes(db, course_id):
    chapters = (
        await db.scalars(
            select(Chapter)
            .where(Chapter.course_id == course_id, Chapter.archived.is_(False))
            .order_by(Chapter.order_index)
        )
    ).all()
    sections = (
        await db.scalars(
            select(Section)
            .join(Chapter)
            .where(
                Chapter.course_id == course_id,
                Section.archived.is_(False),
                Chapter.archived.is_(False),
            )
            .order_by(Section.order_index)
        )
    ).all()
    return chapters, sections


async def snapshot(db, course):
    chapters, sections = await nodes(db, course.id)
    return {
        "chapters": [
            {
                "id": str(c.id),
                "title": c.title,
                "page_start": c.page_start,
                "page_end": c.page_end,
                "sections": [
                    {
                        "id": str(s.id),
                        "title": s.title,
                        "page_start": s.page_start,
                        "page_end": s.page_end,
                    }
                    for s in sections
                    if s.chapter_id == c.id
                ],
            }
            for c in chapters
        ]
    }


async def changes(db, course_id, payload):
    chapters, sections = await nodes(db, course_id)
    current = {str(n.id): n for n in [*chapters, *sections]}
    chapter_ids = {str(c.id) for c in chapters}
    seen = set()
    result = {"added": [], "modified": [], "archived": []}
    for ci, chapter in enumerate(payload["chapters"]):
        for si, item in enumerate([chapter, *chapter["sections"]]):
            node_id = item["id"]
            if node_id in seen:
                raise AppError("INVALID_STRUCTURE", "目录节点 ID 重复")
            seen.add(node_id)
            if node_id.startswith("tmp-"):
                result["added"].append({"id": node_id, "title": item["title"]})
                continue
            old = current.get(node_id)
            if not old or (si == 0) != (node_id in chapter_ids):
                raise AppError("INVALID_REFERENCE", "目录引用不属于当前课程的有效节点")
            position = ci if si == 0 else si - 1
            if (
                old.title != item["title"]
                or old.order_index != position
                or old.page_start != item.get("page_start")
                or old.page_end != item.get("page_end")
                or (si and str(old.chapter_id) != chapter["id"])
            ):
                result["modified"].append(
                    {
                        "id": node_id,
                        "title": item["title"],
                        "previous_title": old.title,
                        "page_start": item.get("page_start"),
                        "page_end": item.get("page_end"),
                    }
                )
    result["archived"] = [
        {"id": key, "title": row.title} for key, row in current.items() if key not in seen
    ]
    affected = await curriculum_archives(db, course_id, [r["id"] for r in result["archived"]])
    result["knowledge_archived"] = [{"id": str(p.id), "title": p.title} for p in affected]
    return result


def version_data(version):
    return {
        name: getattr(version, name)
        for name in (
            "id",
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


async def owned_version(db, course_id, version_id):
    version = await db.scalar(
        select(StructureVersion)
        .where(
            StructureVersion.id == version_id,
            StructureVersion.course_id == course_id,
            StructureVersion.structure_type == "CURRICULUM",
        )
        .with_for_update()
    )
    if not version:
        raise AppError("NOT_FOUND", "目录版本不存在", 404)
    return version


async def new_draft(
    db, course, user_id, payload, source=None, raw_output="", base=None, run_id=None
):
    summary = await changes(db, course.id, payload)
    previous = (
        await db.scalars(
            select(StructureVersion).where(
                StructureVersion.course_id == course.id,
                StructureVersion.status == "DRAFT",
                StructureVersion.structure_type == "CURRICULUM",
            )
        )
    ).all()
    for draft in previous:
        draft.status = "SUPERSEDED"
        db.add(StructureEvent(version_id=draft.id, actor_id=user_id, action="REPLACED", details={}))
    version = StructureVersion(
        user_id=user_id,
        course_id=course.id,
        payload=payload,
        base_course_revision=course.confirmed_revision if base is None else base,
        source=source or {"kind": "manual"},
        generation_run_id=run_id,
        raw_output=raw_output,
        change_summary=summary,
    )
    db.add(version)
    await db.flush()
    db.add(
        StructureEvent(
            version_id=version.id,
            actor_id=user_id,
            action="CREATED",
            details={"base_course_revision": version.base_course_revision},
        )
    )
    await db.commit()
    return version_data(version)


async def confirm(db, course, version, actor_id, revision, base, accept_archives):
    # Idempotency remains true after a later version supersedes this snapshot.
    if version.applied_course_revision is not None:
        return version_data(version)
    if (
        version.status != "DRAFT"
        or version.revision != revision
        or version.base_course_revision != base
        or course.confirmed_revision != base
    ):
        raise conflict()
    summary = await changes(db, course.id, version.payload)
    if version.payload.get("uncertain_items"):
        raise AppError("UNRESOLVED_ITEMS", "请先核对所有不确定项并保存草稿", 409)
    if summary["archived"] and not accept_archives:
        raise AppError("ARCHIVE_CONFIRMATION_REQUIRED", "请核对并确认归档列出的章节与小节", 409)
    chapters, sections = await nodes(db, course.id)
    old = {str(n.id): n for n in [*chapters, *sections]}
    mapping = {}
    for chapter_index, chapter in enumerate(version.payload["chapters"]):
        chapter_id = chapter["id"]
        record = old.get(chapter_id)
        if record is None:
            record = Chapter(id=uuid4(), course_id=course.id)
            db.add(record)
            mapping[chapter_id] = str(record.id)
        record.title, record.order_index, record.archived = chapter["title"], chapter_index, False
        record.page_start, record.page_end = chapter.get("page_start"), chapter.get("page_end")
        await db.flush()
        for section_index, section in enumerate(chapter["sections"]):
            section_id = section["id"]
            child = old.get(section_id)
            if child is None:
                child = Section(id=uuid4(), chapter_id=record.id)
                db.add(child)
                mapping[section_id] = str(child.id)
            child.title, child.order_index, child.archived = section["title"], section_index, False
            child.chapter_id = record.id
            child.page_start, child.page_end = section.get("page_start"), section.get("page_end")
    for removed in summary["archived"]:
        old[removed["id"]].archived = True
    previous = (
        await db.scalars(
            select(StructureVersion).where(
                StructureVersion.course_id == course.id,
                StructureVersion.status == "CONFIRMED",
                StructureVersion.structure_type == "CURRICULUM",
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
    await db.flush()  # Release the partial unique constraint before setting CONFIRMED.
    await archive_for_curriculum(db, course.id, [r["id"] for r in summary["archived"]])
    course.confirmed_revision += 1
    version.status = "CONFIRMED"
    version.applied_course_revision = course.confirmed_revision
    version.id_mapping = mapping
    version.change_summary = summary
    version.confirmed_by = actor_id
    version.confirmed_at = now()
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

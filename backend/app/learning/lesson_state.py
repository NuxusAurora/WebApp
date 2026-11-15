from sqlalchemy import case, func, select

from app.learning.models import LearningLessonRevision


def lesson_query(conversation_id):
    return select(LearningLessonRevision).where(
        LearningLessonRevision.conversation_id == conversation_id
    )


async def current_lesson(db, conversation_id):
    return await db.scalar(
        lesson_query(conversation_id).order_by(LearningLessonRevision.revision.desc()).limit(1)
    )


async def earlier_questions(db, conversation_id, revision):
    """Return the last saved state of each earlier question as of this revision."""
    row = LearningLessonRevision
    legacy_start = func.max(case((row.action == "start", row.revision))).over(
        order_by=row.revision, rows=(None, 0)
    )
    versions = (
        select(row.id, row.revision, row.plan_id, legacy_start.label("legacy_start"))
        .where(row.conversation_id == conversation_id, row.revision <= revision)
        .subquery()
    )
    ranked = select(
        versions.c.id,
        func.row_number()
        .over(
            partition_by=(
                versions.c.plan_id,
                case((versions.c.plan_id.is_(None), versions.c.legacy_start)),
            ),
            order_by=versions.c.revision.desc(),
        )
        .label("rank"),
    ).subquery()
    return list(
        await db.scalars(
            select(row)
            .join(ranked, ranked.c.id == row.id)
            .where(ranked.c.rank == 1, row.revision < revision)
            .order_by(row.revision)
        )
    )


def legacy_state_data(lesson: LearningLessonRevision | None) -> dict:
    """Keep pre-protocol snapshots readable without inferring a plan from them."""
    return {"revision": lesson.revision, **lesson.state} if lesson else {"revision": 0}

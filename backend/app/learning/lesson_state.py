from sqlalchemy import case, func, select

from app.learning.models import LearningLessonPlan, LearningLessonRevision


def lesson_query(conversation_id):
    return select(LearningLessonRevision).where(
        LearningLessonRevision.conversation_id == conversation_id
    )


async def current_lesson(db, conversation_id):
    return await db.scalar(
        lesson_query(conversation_id).order_by(LearningLessonRevision.revision.desc()).limit(1)
    )


async def question_timeline(db, conversation_id, revision):
    """Return each question's latest state and original position as of this revision."""
    row = LearningLessonRevision
    legacy_start = func.max(case((row.action == "start", row.revision))).over(
        order_by=row.revision, rows=(None, 0)
    )
    versions = (
        select(row.id, row.revision, row.plan_id, legacy_start.label("legacy_start"))
        .where(row.conversation_id == conversation_id, row.revision <= revision)
        .subquery()
    )
    question = (
        versions.c.plan_id,
        case((versions.c.plan_id.is_(None), versions.c.legacy_start)),
    )
    ranked = select(
        versions.c.id,
        func.min(versions.c.revision).over(partition_by=question).label("first_revision"),
        func.row_number()
        .over(partition_by=question, order_by=versions.c.revision.desc())
        .label("rank"),
    ).subquery()
    result = await db.execute(
        select(row, ranked.c.first_revision)
        .join(ranked, ranked.c.id == row.id)
        .where(ranked.c.rank == 1)
        .order_by(ranked.c.first_revision)
    )
    return result.all()


async def saved_question_for_type(db, timeline, practice, type_index, content_version_id):
    candidates = [
        row
        for row, _ in reversed(timeline)
        if row.plan_id is not None
        and (saved := row.state.get("practice"))
        and saved["current"] == type_index
        and saved["types"] == practice["types"]
    ]
    if not candidates:
        return None
    current_plans = set(
        await db.scalars(
            select(LearningLessonPlan.plan_id).where(
                LearningLessonPlan.plan_id.in_([row.plan_id for row in candidates]),
                LearningLessonPlan.content_version_id == content_version_id,
            )
        )
    )
    return next(
        ((row.plan_id, row.state) for row in candidates if row.plan_id in current_plans), None
    )


def legacy_state_data(lesson: LearningLessonRevision | None) -> dict:
    """Keep pre-protocol snapshots readable without inferring a plan from them."""
    return {"revision": lesson.revision, **lesson.state} if lesson else {"revision": 0}

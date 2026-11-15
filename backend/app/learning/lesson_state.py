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
        select(row, ranked.c.first_revision, LearningLessonPlan.content_version_id)
        .join(ranked, ranked.c.id == row.id)
        .outerjoin(LearningLessonPlan, row.plan_id == LearningLessonPlan.plan_id)
        .where(ranked.c.rank == 1)
        .order_by(ranked.c.first_revision)
    )
    return result.all()


def saved_questions_by_type(timeline, practice, content_version_id):
    """Use the newest question per type from the same curriculum version and practice plan."""
    questions = {}
    for row, _, version in timeline:
        if row.plan_id is None or version != content_version_id:
            continue
        saved = row.state.get("practice")
        if saved and saved["types"] == practice["types"]:
            questions[saved["current"]] = (row.plan_id, row.state)
    return questions


def legacy_state_data(lesson: LearningLessonRevision | None) -> dict:
    """Keep pre-protocol snapshots readable without inferring a plan from them."""
    return {"revision": lesson.revision, **lesson.state} if lesson else {"revision": 0}

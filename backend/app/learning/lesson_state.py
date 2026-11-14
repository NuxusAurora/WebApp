from sqlalchemy import select

from app.learning.models import LearningLessonRevision


def lesson_query(conversation_id):
    return select(LearningLessonRevision).where(
        LearningLessonRevision.conversation_id == conversation_id
    )


async def current_lesson(db, conversation_id):
    return await db.scalar(
        lesson_query(conversation_id).order_by(LearningLessonRevision.revision.desc()).limit(1)
    )


def legacy_state_data(lesson: LearningLessonRevision | None) -> dict:
    """Keep pre-protocol snapshots readable without inferring a plan from them."""
    return {"revision": lesson.revision, **lesson.state} if lesson else {"revision": 0}

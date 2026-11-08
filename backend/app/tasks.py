from celery import Celery

from app.config import Settings


def create_celery(settings: Settings | None = None) -> Celery:
    configured = settings or Settings()
    application = Celery("structured_learning")
    application.conf.update(
        broker_url=configured.celery_broker_url.get_secret_value(),
        result_backend=configured.celery_result_backend.get_secret_value(),
        task_serializer="json",
        result_serializer="json",
        accept_content=["json"],
        result_expires=300,
        broker_connection_retry_on_startup=True,
        broker_connection_retry=True,
        broker_connection_timeout=2,
        broker_transport_options={"socket_connect_timeout": 2, "socket_timeout": 2},
        redis_socket_connect_timeout=2,
        redis_socket_timeout=2,
        task_soft_time_limit=5,
        task_time_limit=10,
        worker_prefetch_multiplier=1,
        worker_hijack_root_logger=False,
        worker_send_task_events=False,
    )

    @application.task(name="phase0.smoke", shared=False)
    def smoke():
        return {"status": "ok"}

    return application


celery_app = create_celery()

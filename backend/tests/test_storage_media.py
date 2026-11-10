from unittest.mock import Mock

import pytest

from app.storage import ObjectStore


@pytest.mark.parametrize(
    "suffix, media_type, filename",
    [
        (".jpg", "image/jpeg", "curriculum.jpg"),
        (".png", "image/png", "curriculum.png"),
        (".txt", "text/plain; charset=utf-8", "learning-material.txt"),
    ],
)
def test_object_upload_and_private_download_have_matching_media(suffix, media_type, filename):
    store = ObjectStore.__new__(ObjectStore)
    store.bucket = "private"
    store.client = Mock()
    store.public = Mock()
    key = "owner/course/image" + suffix
    store.put(key, b"content")
    assert store.client.put_object.call_args.kwargs["ContentType"] == media_type
    store.download(key)
    args = store.public.generate_presigned_url.call_args.kwargs
    assert args["Params"]["ResponseContentType"] == media_type
    assert args["Params"]["ResponseContentDisposition"] == f'attachment; filename="{filename}"'
    assert args["ExpiresIn"] == 60

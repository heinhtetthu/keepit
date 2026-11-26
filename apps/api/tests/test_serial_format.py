from datetime import date

from app.services.serial_format import format_serial_number, validate_serial_format
from app.services.documents.validation import validate_upload

D = date(2026, 3, 7)


def test_tokens():
    assert format_serial_number("UPS-{YY}-{SEQ:4}", 1, D) == "UPS-26-0001"
    assert format_serial_number("{MSE}-{YY}{MM}{DD}-{SEQ}", 12, D) == "MSE-260307-0012"
    assert format_serial_number("{TYPE}-{SEQ:2}", 5, D, "Access Point") == "ACCESS_POINT-05"
    assert format_serial_number("X{SEQ:3}", 0, D) == "X001"


def test_validation():
    assert validate_serial_format("A-{SEQ:4}") is None
    assert validate_serial_format("A-{SEQ:x}") is not None
    assert validate_serial_format("A-{SEQ:11}") is not None
    assert validate_serial_format("x" * 41) is not None


def test_upload_validation():
    assert validate_upload("a.pdf", "application/pdf", b"%PDF-1.7" + b"0" * 10, 100)[0] is None
    assert validate_upload("a.pdf", "application/pdf", b"PK" + b"0" * 20, 100)[0]
    assert validate_upload("a.csv", "text/plain", b"a,b\n1,2\n", 100) == (None, "text/csv")
    assert validate_upload("a.exe", None, b"0" * 20, 100)[0]
    assert validate_upload("a.png", "image/jpeg", b"\x89PNG" + b"0" * 20, 100)[0]
    assert validate_upload("a.txt", "text/plain", b"x" * 101, 100)[0]

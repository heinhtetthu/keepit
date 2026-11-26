"""Provider-free checks for authenticated backup framing and truncation."""
import hashlib
from io import BytesIO
import os
from pathlib import Path
import struct
import tempfile
from cryptography.fernet import Fernet, InvalidToken
import secure_backup

os.environ['BACKUP_ENCRYPTION_KEY'] = Fernet.generate_key().decode()
crypt = secure_backup.cipher()
body = b'disposable backup fixture'


def frame(payload):
    token = crypt.encrypt(payload)
    return struct.pack('>I', len(token)) + token


valid = secure_backup.MAGIC + frame(b'D' + struct.pack('>Q', 0) + body) + frame(b'F' + struct.pack('>Q', 1) + hashlib.sha256(body).digest())
with tempfile.TemporaryDirectory() as folder:
    path = Path(folder) / 'fixture.enc'
    path.write_bytes(valid)
    output = BytesIO()
    secure_backup.decrypt_to(path, output)
    assert output.getvalue() == body
    for broken in (valid[:-1], valid + b'extra', valid[:30] + b'X' + valid[31:], secure_backup.MAGIC + frame(b'D' + struct.pack('>Q', 5) + body)):
        path.write_bytes(broken)
        try:
            secure_backup.decrypt_to(path, BytesIO())
        except (ValueError, InvalidToken):
            pass
        else:
            raise AssertionError('Invalid backup accepted')
print('BACKUP_FORMAT_OK: round-trip, corruption, truncation, trailing bytes and frame order')

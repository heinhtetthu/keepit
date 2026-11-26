"""Protected text values are never included in ordinary serializers or delivery."""
import json
from app.services.encryption import encrypt, decrypt


def pack(field, value):
    return {'secret': encrypt(json.dumps(value))} if field.field_type == 'secret' and value not in (None, '') else {'value': value}


def unpack(value):
    if isinstance(value, dict) and value.get('secret'):
        return json.loads(decrypt(value['secret']))
    return value.get('value') if isinstance(value, dict) else value


def protect(field):
    if field.field_type == 'secret':
        field.searchable = field.sortable = field.filterable = field.show_in_list = field.show_in_reports = field.unique = False
        field.default_value = None

from contextvars import ContextVar

current_actor = ContextVar('current_actor', default=None)

"""Bound idle polling without delaying active batches or shutdown."""


class IdleBackoff:
    def __init__(self, active_seconds: float, maximum_seconds: float = 30.0):
        self.active_seconds = max(0.1, active_seconds)
        self.maximum_seconds = max(self.active_seconds, maximum_seconds)
        self.delay = self.active_seconds

    def next_delay(self, *, busy: bool) -> float:
        if busy:
            self.delay = self.active_seconds
        else:
            self.delay = min(self.maximum_seconds, self.delay * 2)
        return self.delay

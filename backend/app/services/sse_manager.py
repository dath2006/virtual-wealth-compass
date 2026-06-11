import asyncio
import json
from typing import AsyncGenerator


class SSEManager:
    """
    In-process SSE broadcaster.
    For multi-process deployments, replace with Redis pub/sub.
    Single-process (one uvicorn worker) is fine for personal use.
    """
    def __init__(self):
        self._listeners: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=50)
        self._listeners.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue):
        try:
            self._listeners.remove(q)
        except ValueError:
            pass

    async def push(self, event: dict):
        """Push an event to all connected browser clients."""
        data = json.dumps(event)
        dead = []
        for q in self._listeners:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                dead.append(q)   # client too slow — disconnect them
        for q in dead:
            self.unsubscribe(q)

    async def stream(self, q: asyncio.Queue) -> AsyncGenerator[str, None]:
        """AsyncGenerator that yields SSE-formatted strings."""
        try:
            while True:
                data = await asyncio.wait_for(q.get(), timeout=30.0)
                yield f"data: {data}\n\n"
        except asyncio.TimeoutError:
            # Send keepalive ping every 30s to prevent proxy timeouts
            yield ": keepalive\n\n"
        except asyncio.CancelledError:
            return


# Singleton — imported by routers that need to push events
sse_manager = SSEManager()

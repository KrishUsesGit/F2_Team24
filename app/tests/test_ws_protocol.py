"""Pure unit tests for the hand-rolled WebSocket protocol layer —
no network, no root required."""
import asyncio
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from ws_protocol import (
    compute_accept_key, encode_frame, read_frame, OPCODE_TEXT, OPCODE_CLOSE,
)


class TestAcceptKey(unittest.TestCase):
    def test_rfc6455_worked_example(self):
        # RFC 6455 §1.3's own worked example.
        client_key = "dGhlIHNhbXBsZSBub25jZQ=="
        expected = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
        self.assertEqual(compute_accept_key(client_key), expected)


class TestFrameRoundTrip(unittest.IsolatedAsyncioTestCase):
    async def test_unmasked_text_round_trip(self):
        payload = b'{"type":"ping","seq":42}'
        frame = encode_frame(payload, OPCODE_TEXT, masked=False)
        reader = asyncio.StreamReader()
        reader.feed_data(frame)
        reader.feed_eof()
        opcode, decoded = await read_frame(reader)
        self.assertEqual(opcode, OPCODE_TEXT)
        self.assertEqual(decoded, payload)

    async def test_masked_text_round_trip(self):
        # client->server frames must be masked; masking must be reversible
        payload = b'{"type":"interaction","seq":7}'
        frame = encode_frame(payload, OPCODE_TEXT, masked=True)
        # confirm masking actually changed the bytes on the wire (not a no-op)
        self.assertNotIn(payload, frame)
        reader = asyncio.StreamReader()
        reader.feed_data(frame)
        reader.feed_eof()
        opcode, decoded = await read_frame(reader)
        self.assertEqual(opcode, OPCODE_TEXT)
        self.assertEqual(decoded, payload)

    async def test_extended_length_16bit(self):
        payload = b"x" * 5000  # > 125, triggers the 16-bit extended length path
        frame = encode_frame(payload, OPCODE_TEXT, masked=False)
        reader = asyncio.StreamReader()
        reader.feed_data(frame)
        reader.feed_eof()
        opcode, decoded = await read_frame(reader)
        self.assertEqual(len(decoded), 5000)
        self.assertEqual(decoded, payload)

    async def test_close_frame(self):
        frame = encode_frame(b"", OPCODE_CLOSE, masked=False)
        reader = asyncio.StreamReader()
        reader.feed_data(frame)
        reader.feed_eof()
        opcode, decoded = await read_frame(reader)
        self.assertEqual(opcode, OPCODE_CLOSE)
        self.assertEqual(decoded, b"")


if __name__ == "__main__":
    unittest.main()

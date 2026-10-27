"""GroundTruthEvent storage — spec §04/§06.

CRITICAL: this database MUST live on the native WSL/Linux filesystem,
NEVER under the Windows-mounted project directory. Empirically verified
(this session): drvfs (/mnt/c) silently ignores chmod -- a file "chmod
600"'d there is still world-readable on disk regardless of the command's
reported success. Only a native filesystem (ext4, here) actually
enforces Unix permission bits, which is the entire mechanism C4 depends
on. DB_PATH below is deliberately NOT under /mnt/c.

This module may be imported by the controller (write side, run as
hoptrace-truth) and by an eval-side reader (run as hoptrace-eval) --
the isolation guarantee comes from OS file permissions on DB_PATH
(owned hoptrace-truth:hoptrace-truth, mode 640), not from who imports
this code. correlate/ (the localization engine) never imports this
module, and never will -- the isolation boundary is enforced twice:
structurally (no code path) and by the OS (permission bits).
"""
from __future__ import annotations

import json
import os
import sqlite3

DB_DIR = "/var/lib/hoptrace"
DB_PATH = os.path.join(DB_DIR, "groundtruth.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS ground_truth_events (
    event_id TEXT PRIMARY KEY,
    trial_id TEXT NOT NULL,
    hop_target INTEGER NOT NULL,
    impairment_type TEXT NOT NULL,
    magnitude TEXT NOT NULL,
    t_start_mono_ns INTEGER NOT NULL,
    t_end_mono_ns INTEGER,
    tc_command TEXT NOT NULL
);
"""


def connect(db_path: str | None = None) -> sqlite3.Connection:
    if db_path is None:
        db_path = DB_PATH  # looked up at call time, not bound at def time -- keeps this patchable in tests
    first_time = not os.path.exists(db_path)
    conn = sqlite3.connect(db_path)
    conn.execute(SCHEMA)
    conn.commit()
    if first_time:
        os.chmod(db_path, 0o640)  # owner rw, group r, other NONE (C4)
    return conn


def insert_event(conn: sqlite3.Connection, event: dict) -> None:
    conn.execute(
        "INSERT INTO ground_truth_events "
        "(event_id, trial_id, hop_target, impairment_type, magnitude, "
        " t_start_mono_ns, t_end_mono_ns, tc_command) VALUES (?,?,?,?,?,?,?,?)",
        (event["event_id"], event["trial_id"], event["hop_target"], event["impairment_type"],
         json.dumps(event["magnitude"]), event["t_start_mono_ns"], event.get("t_end_mono_ns"),
         event["tc_command"]),
    )
    conn.commit()


def set_end_time(conn: sqlite3.Connection, event_id: str, t_end_mono_ns: int) -> None:
    conn.execute("UPDATE ground_truth_events SET t_end_mono_ns=? WHERE event_id=?",
                 (t_end_mono_ns, event_id))
    conn.commit()


def _row_to_dict(r) -> dict:
    return {
        "event_id": r[0], "trial_id": r[1], "hop_target": r[2], "impairment_type": r[3],
        "magnitude": json.loads(r[4]), "t_start_mono_ns": r[5], "t_end_mono_ns": r[6],
        "tc_command": r[7],
    }


def read_all(conn: sqlite3.Connection) -> list:
    cur = conn.execute(
        "SELECT event_id, trial_id, hop_target, impairment_type, magnitude, "
        "t_start_mono_ns, t_end_mono_ns, tc_command FROM ground_truth_events"
    )
    return [_row_to_dict(r) for r in cur.fetchall()]


def find_open_event(conn: sqlite3.Connection, trial_id: str, hop_target: int) -> dict | None:
    """The most recent event for (trial_id, hop_target) with no t_end_mono_ns yet."""
    cur = conn.execute(
        "SELECT event_id, trial_id, hop_target, impairment_type, magnitude, "
        "t_start_mono_ns, t_end_mono_ns, tc_command FROM ground_truth_events "
        "WHERE trial_id=? AND hop_target=? AND t_end_mono_ns IS NULL "
        "ORDER BY t_start_mono_ns DESC LIMIT 1",
        (trial_id, hop_target),
    )
    row = cur.fetchone()
    return _row_to_dict(row) if row else None


def read_for_trial(conn: sqlite3.Connection, trial_id: str) -> list:
    cur = conn.execute(
        "SELECT event_id, trial_id, hop_target, impairment_type, magnitude, "
        "t_start_mono_ns, t_end_mono_ns, tc_command FROM ground_truth_events WHERE trial_id=?",
        (trial_id,),
    )
    return [_row_to_dict(r) for r in cur.fetchall()]

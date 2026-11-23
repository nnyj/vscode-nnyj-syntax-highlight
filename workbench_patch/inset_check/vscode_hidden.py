"""Run a VS Code test instance on a hidden Win32 desktop, for CDP-driven agents.

The window never shows on the user's desktop and never takes focus.

Usage:
  python vscode_hidden.py start <Code.exe args...>
    Env VSCODE_EXE overrides the Code.exe path, for a copied install. Returns once the CDP port from --remote-debugging-port=N answers.
  python vscode_hidden.py stop <user-data-dir>
    Kills every process started with that --user-data-dir, plus their children.
"""
import ctypes
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from ctypes import wintypes

CODE_EXE = os.environ.get("VSCODE_EXE") or os.path.join(os.environ["LOCALAPPDATA"], "Programs", "Microsoft VS Code", "Code.exe")
GENERIC_ALL = 0x10000000
CDP_TIMEOUT_S = 60

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.CreateDesktopW.restype = wintypes.HANDLE


class StartupInfo(ctypes.Structure):
  _fields_ = [
    ("cb", wintypes.DWORD),
    ("lpReserved", wintypes.LPWSTR),
    ("lpDesktop", wintypes.LPWSTR),
    ("lpTitle", wintypes.LPWSTR),
    ("dwX", wintypes.DWORD),
    ("dwY", wintypes.DWORD),
    ("dwXSize", wintypes.DWORD),
    ("dwYSize", wintypes.DWORD),
    ("dwXCountChars", wintypes.DWORD),
    ("dwYCountChars", wintypes.DWORD),
    ("dwFillAttribute", wintypes.DWORD),
    ("dwFlags", wintypes.DWORD),
    ("wShowWindow", wintypes.WORD),
    ("cbReserved2", wintypes.WORD),
    ("lpReserved2", ctypes.c_void_p),
    ("hStdInput", wintypes.HANDLE),
    ("hStdOutput", wintypes.HANDLE),
    ("hStdError", wintypes.HANDLE),
  ]


class ProcessInformation(ctypes.Structure):
  _fields_ = [
    ("hProcess", wintypes.HANDLE),
    ("hThread", wintypes.HANDLE),
    ("dwProcessId", wintypes.DWORD),
    ("dwThreadId", wintypes.DWORD),
  ]


def cdp_port(code_args):
  for arg in code_args:
    if arg.startswith("--remote-debugging-port="):
      return int(arg.split("=", 1)[1])
  return None


def cdp_answers(port):
  try:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1) as response:
      return "webSocketDebuggerUrl" in json.loads(response.read())
  except (OSError, ValueError):
    return False


def port_in_use(port):
  with socket.socket() as probe:
    return probe.connect_ex(("127.0.0.1", port)) == 0


def start(code_args):
  port = cdp_port(code_args)
  if port and port_in_use(port):
    sys.exit(f"port {port} is already in use")
  desktop_name = f"vsc_hidden_{os.getpid()}"
  desktop = user32.CreateDesktopW(desktop_name, None, None, 0, GENERIC_ALL, None)
  if not desktop:
    raise ctypes.WinError(ctypes.get_last_error())
  # Electron started from a node-hosted shell inherits this and runs as plain node.
  os.environ.pop("ELECTRON_RUN_AS_NODE", None)
  startup_info = StartupInfo(cb=ctypes.sizeof(StartupInfo), lpDesktop=f"WinSta0\\{desktop_name}")
  process_info = ProcessInformation()
  command_line = subprocess.list2cmdline([CODE_EXE, *code_args])
  created = kernel32.CreateProcessW(
    None, command_line, None, None, False, 0, None, None,
    ctypes.byref(startup_info), ctypes.byref(process_info))
  if not created:
    raise ctypes.WinError(ctypes.get_last_error())
  print(f"pid {process_info.dwProcessId} on desktop {desktop_name}")
  if port:
    deadline = time.time() + CDP_TIMEOUT_S
    while not cdp_answers(port):
      if time.time() > deadline:
        sys.exit(f"CDP port {port} did not answer within {CDP_TIMEOUT_S} s")
      time.sleep(0.5)
    print(f"CDP ready on http://127.0.0.1:{port}")
  # The desktop stays alive while Code.exe threads use it, the launcher handle can close.
  user32.CloseDesktop(desktop)
  kernel32.CloseHandle(process_info.hThread)
  kernel32.CloseHandle(process_info.hProcess)


def normalize(text):
  return text.replace("\\", "/").replace('"', "").lower()


def instance_pids(user_data_dir):
  query = "Get-CimInstance Win32_Process | Select-Object ProcessId, CommandLine | ConvertTo-Json"
  output = subprocess.run(
    ["powershell", "-NoProfile", "-Command", query], capture_output=True, text=True, check=True).stdout
  target = normalize(user_data_dir).rstrip("/")
  pids = []
  for process in json.loads(output):
    command_line = normalize(process["CommandLine"] or "")
    if "--user-data-dir" not in command_line:
      continue
    if f"{target} " in command_line or command_line.endswith(target):
      pids.append(process["ProcessId"])
  return pids


def stop(user_data_dir):
  pids = instance_pids(user_data_dir)
  if not pids:
    print("no process found")
    return
  pid_args = [part for pid in pids for part in ("/pid", str(pid))]
  subprocess.run(["taskkill", "/f", "/t", *pid_args], capture_output=True)
  print(f"killed {len(pids)} processes")


def main():
  if len(sys.argv) < 3 or sys.argv[1] not in ("start", "stop"):
    sys.exit(__doc__)
  if sys.argv[1] == "start":
    start(sys.argv[2:])
  else:
    stop(sys.argv[2])


if __name__ == "__main__":
  main()

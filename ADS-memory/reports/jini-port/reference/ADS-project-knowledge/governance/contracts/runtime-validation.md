# Runtime Validation

Status: DRAFT

Declare how agents should boot, smoke-check, and stop the host app when work
changes runtime behavior.

## boot_command
- Command: <fill during project bootstrap>
- Working directory: <project root or specific path>
- Timeout: 60

## healthy_signal
- Signal type: <stdout_match | http_status | port_open | file_exists>
- Value: <fill during project bootstrap>

## critical_path_check
- Command: <fill during project bootstrap, or "not yet available">
- Required: no
- Blocking: no

## teardown
- Command: <fill during project bootstrap, or "N/A">

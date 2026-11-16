"""Save the scoped Web Push sender keys over USB without printing them.

The ESP32 must be disconnected from the stove and connected to this computer.
This does not erase existing Wi-Fi, Firebase or hopper settings.
"""
import argparse
import json
import pathlib
import re
import time
import serial

parser = argparse.ArgumentParser()
parser.add_argument('port', help='ESP32 USB serial port')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
config = json.loads((root / '.secrets/web-push.json').read_text())
if not re.fullmatch(r'[A-Za-z0-9_-]{87}', config.get('publicKey', '')) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', config.get('privateKey', '')):
    raise SystemExit('Invalid notification settings.')
payload = {key: config[key] for key in ('publicKey', 'privateKey')}
line = 'SETPUSH:' + json.dumps(payload, separators=(',', ':')) + '\n'
with serial.Serial(args.port, 115200, timeout=1, dsrdtr=False, rtscts=False) as port:
    port.dtr = True
    port.rts = False
    port.reset_input_buffer()
    port.write(line.encode())
    port.flush()
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        reply = port.readline()
        if b'[push] Configuration saved;' in reply:
            print('Notification settings saved. Reset only the ESP32 module.')
            break
        if b'[push] Invalid configuration' in reply or b'[push] Configuration was not saved' in reply:
            raise SystemExit('The module did not save notification settings.')
    else:
        raise SystemExit('No acknowledgement. Check the connection and module version; keys are not printed.')

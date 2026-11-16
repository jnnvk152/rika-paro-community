"""Configure the ESP32 over its USB serial port without printing credentials."""
import argparse
import json
import pathlib
import time
import serial

parser=argparse.ArgumentParser()
parser.add_argument('port',help='ESP32 USB serial port, e.g. /dev/cu.usbmodem...')
args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parent.parent
config=json.loads((root/'.secrets/device-credentials.json').read_text())
payload={key:config[key] for key in ('apiKey','databaseURL','refreshToken')}
line='SETCLOUD:'+json.dumps(payload,separators=(',',':'))+'\n'
with serial.Serial(args.port,115200,timeout=1,dsrdtr=False,rtscts=False) as port:
    port.dtr=True  # native USB CDC needs DTR to return the acknowledgement
    port.rts=False
    port.reset_input_buffer()
    port.write(line.encode())
    port.flush()
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        reply=port.readline()
        if b'[cloud] Configuration saved;' in reply:
            print('Settings saved. Reset only the ESP32 module to enable Firebase.')
            break
        if b'[cloud] Invalid configuration' in reply or b'[cloud] Configuration was not saved' in reply:
            raise SystemExit('The module did not save the settings.')
    else:
        raise SystemExit('No acknowledgement. Check the connection and firmware; credentials are not printed.')

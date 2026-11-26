"""Run the shared browser smoke journey in an installed Firefox through Selenium.

Requires Selenium (pip install selenium), or PATCH3Q_SELENIUM_PATH pointing to a
separate test-only installation. Browser profiles and app dependencies are isolated.
"""
import json
import os
import subprocess
import sys
import threading

# Node sends UTF-8 JSON; Windows' default console code page corrupts Unicode selectors.
sys.stdin.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")

if os.environ.get("PATCH3Q_SELENIUM_PATH"):
    sys.path.insert(0, os.environ["PATCH3Q_SELENIUM_PATH"])

from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

lock = threading.Lock()


def emit(value):
    with lock:
        print(json.dumps(value), flush=True)


options = Options()
options.binary_location = sys.argv[1]
options.add_argument("-headless")
options.add_argument("-no-remote")
options.add_argument("-new-instance")
options.add_argument("-profile")
options.add_argument(sys.argv[3])
options.enable_bidi = True
service = Service(log_output=os.path.join(os.environ.get("PATCH3Q_BROWSER_OUTPUT", "."), "firefox-driver.log"),
                  service_args=["--log", "debug"],
                  popen_kw={"creation_flags": subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0})
driver = webdriver.Firefox(options=options, service=service)
driver.set_script_timeout(60)
driver.set_page_load_timeout(60)


def log_entry(entry):
    if getattr(entry, "level", "") == "error":
        emit({"method": "Log.entryAdded", "params": {"entry": {
            "level": "error", "text": getattr(entry, "text", str(entry)), "url": None,
        }}})


try:
    driver.script.add_console_message_handler(log_entry)
    driver.script.add_javascript_error_handler(log_entry)
    driver.get(sys.argv[2])
    emit({"ready": True})
    for line in sys.stdin:
        request = json.loads(line)
        method, params = request["method"], request.get("params", {})
        try:
            result = {}
            if method == "Runtime.evaluate":
                evaluated = driver.execute_async_script("""
                  const done = arguments[arguments.length - 1];
                  try { Promise.resolve((0, eval)(arguments[0])).then(
                    value => done({value: value ?? null}), error => done({error: String(error)})); }
                  catch (error) { done({error: String(error)}); }
                """, params["expression"])
                if "error" in evaluated:
                    result = {"exceptionDetails": {"text": evaluated["error"]}}
                else:
                    result = {"result": {"value": evaluated["value"]}}
            elif method == "Emulation.setDeviceMetricsOverride":
                width, height = params["width"], params["height"]
                driver.browsing_context.set_viewport(context=driver.current_window_handle,
                    viewport={"width": width, "height": height}, device_pixel_ratio=1)
                actual = driver.execute_script("return [innerWidth, innerHeight]")
                if actual != [width, height]:
                    raise RuntimeError(f"Requested viewport {[width, height]}, got {actual}")
            elif method == "Page.captureScreenshot":
                result = {"data": driver.get_screenshot_as_base64()}
            elif method not in ("Page.enable", "Runtime.enable", "Log.enable"):
                raise RuntimeError(f"Unsupported smoke command: {method}")
            emit({"id": request["id"], "result": result})
        except Exception as error:
            emit({"id": request["id"], "error": {"message": str(error)}})
finally:
    driver.quit()

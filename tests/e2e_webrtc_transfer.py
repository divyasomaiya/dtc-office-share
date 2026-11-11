"""
End-to-end browser test for DTC Office Share:
Tests 2 browser contexts performing WebRTC P2P transfer,
recipient approval modal, chunk streaming, and completion.
"""

import os
import subprocess
import time
from playwright.sync_api import sync_playwright

def run_e2e_test():
    port = "3399"
    env = os.environ.copy()
    env["PORT"] = port

    # Start the server as background process
    server_proc = subprocess.Popen(["node", "src/server.js"], env=env)
    time.sleep(1.5)

    test_file_path = "/tmp/test-office-doc.txt"
    with open(test_file_path, "w") as f:
        f.write("DTC Office Share P2P WebRTC Transfer Payload Verified!" * 50)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--use-fake-ui-for-media-stream", "--no-sandbox"]
            )
            context1 = browser.new_context()
            context2 = browser.new_context()

            page1 = context1.new_page()
            page2 = context2.new_page()

            # Context 1: Sender (MacBook)
            page1.goto(f"http://localhost:{port}")
            page1.wait_for_timeout(1000)

            page1.click("#btn-edit-name")
            page1.fill("#input-device-name", "MacBook-Sender")
            page1.click("#btn-save-name")
            page1.wait_for_timeout(500)

            # Context 2: Recipient (Windows PC)
            page2.goto(f"http://localhost:{port}")
            page2.wait_for_timeout(1000)

            page2.click("#btn-edit-name")
            page2.fill("#input-device-name", "Windows-Receiver")
            page2.click("#btn-save-name")
            page2.wait_for_timeout(1000)

            # Locate receiver button on page1
            receiver_btn = page1.locator(".peer-btn", has_text="Windows-Receiver")
            receiver_btn.wait_for(state="visible", timeout=5000)
            print("Discovered receiver peer in radar grid.")

            # Initiate transfer by selecting file
            receiver_btn.click()
            file_input = page1.locator("#file-input")
            file_input.set_input_files(test_file_path)

            # Verify recipient approval modal pops up
            accept_modal = page2.locator("#modal-request")
            accept_modal.wait_for(state="visible", timeout=5000)
            print("Incoming transfer request modal displayed on recipient.")

            summary_text = page2.locator("#request-files-summary").inner_text()
            assert "test-office-doc.txt" in summary_text, f"Filename missing in modal: {summary_text}"

            # Recipient clicks Accept & Download
            page2.click("#btn-accept-transfer")
            print("Recipient accepted transfer.")

            # Wait for completed received section on Page 2
            completed_section = page2.locator("#completed-section")
            completed_section.wait_for(state="visible", timeout=10000)

            completed_text = page2.locator("#completed-list").inner_text()
            assert "test-office-doc.txt" in completed_text, f"Completed list missing file: {completed_text}"
            print("WebRTC transfer successfully completed and verified!")

            context1.close()
            context2.close()
            browser.close()
    finally:
        server_proc.terminate()
        server_proc.wait()
        if os.path.exists(test_file_path):
            os.remove(test_file_path)

if __name__ == "__main__":
    run_e2e_test()
    print("E2E WebRTC Test PASSED")

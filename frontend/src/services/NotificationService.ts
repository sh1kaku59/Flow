let intervalId: any = null;

// store notified jobs to prevent duplicate notifications
const notifiedJobs = new Set<string>();

export function startNotificationPolling(
  API_BASE: string,
  onNotify: (message: string, type: "success" | "error") => void
) {
  if (intervalId) return; // already running

  intervalId = setInterval(async () => {
    try {
      const res = await fetch(`${API_BASE}/meetings`, {
        credentials: "include",
      });

      if (!res.ok) return;

      const meetings = await res.json();

      for (const meeting of meetings || []) {
        const meetingId = meeting.id;

        const statusRes = await fetch(
          `${API_BASE}/audio/${meetingId}/status`,
          { credentials: "include" }
        );

        if (!statusRes.ok) continue;

        const data = await statusRes.json();

        const jobId = data?.job_id || meetingId; // fallback
        const status = (data?.status || "").toLowerCase();

        // Skip if already notified
        if (notifiedJobs.has(jobId)) continue;

        if (status === "completed") {
          notifiedJobs.add(jobId);

          onNotify(
            `✅ "${meeting.title || "Meeting"}" processed successfully`,
            "success"
          );
        }

        if (status === "failed") {
          notifiedJobs.add(jobId);

          onNotify(
            `❌ "${meeting.title || "Meeting"}" failed to process`,
            "error"
          );
        }
      }
    } catch {
      // silent fail
    }
  }, 5000); // every 5s
}

export function stopNotificationPolling() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
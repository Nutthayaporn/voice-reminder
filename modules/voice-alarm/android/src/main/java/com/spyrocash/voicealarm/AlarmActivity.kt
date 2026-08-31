package com.spyrocash.voicealarm

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class AlarmActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(
      WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
    )
    render()
  }

  private fun render() {
    val payload = VoiceAlarmScheduler.payloadFromIntent(intent) ?: run {
      finish()
      return
    }
    val density = resources.displayMetrics.density
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding((28 * density).toInt(), 0, (28 * density).toInt(), 0)
      setBackgroundColor(Color.rgb(2, 7, 12))
    }
    root.addView(TextView(this).apply {
      text = "V.O.R.A.  ·  ALARM"
      setTextColor(Color.rgb(68, 241, 255))
      textSize = 14f
      gravity = Gravity.CENTER
    })
    root.addView(TextView(this).apply {
      text = payload.title
      setTextColor(Color.WHITE)
      textSize = 32f
      gravity = Gravity.CENTER
      setPadding(0, (28 * density).toInt(), 0, (40 * density).toInt())
    })
    root.addView(TextView(this).apply {
      text = "รอบ ${payload.snoozeCount + 1}/${payload.maxAttempts}"
      setTextColor(Color.LTGRAY)
      textSize = 14f
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, (18 * density).toInt())
    })
    if (payload.snoozeCount + 1 < payload.maxAttempts) {
      root.addView(Button(this).apply {
        text = "เลื่อนปลุก ${payload.snoozeMinutes} นาที"
        setOnClickListener {
          if (VoiceAlarmScheduler.scheduleSnooze(this@AlarmActivity, payload)) stopAndFinish()
        }
      })
    }
    root.addView(Button(this).apply {
      text = if (payload.remindUntilDone) "ทำแล้ว" else "หยุด"
      setOnClickListener {
        if (payload.remindUntilDone) VoiceAlarmScheduler.markDone(this@AlarmActivity, payload)
        stopAndFinish()
      }
    })
    setContentView(root)
  }

  private fun stopAndFinish() {
    stopService(Intent(this, AlarmRingingService::class.java))
    finishAndRemoveTask()
  }

  companion object {
    internal fun intent(context: Context, payload: VoiceAlarmPayload) =
      Intent(context, AlarmActivity::class.java)
        .putExtra(AlarmRingingService.EXTRA_PAYLOAD, payload.toJson())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  }
}

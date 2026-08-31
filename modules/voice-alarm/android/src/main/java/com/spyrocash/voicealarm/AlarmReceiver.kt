package com.spyrocash.voicealarm

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = VoiceAlarmScheduler.payloadFromIntent(intent) ?: return
    VoiceAlarmScheduler.afterFire(context, payload.id)
    val service = AlarmRingingService.ringIntent(context, payload)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(service)
    else context.startService(service)
  }
}

class AlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    VoiceAlarmScheduler.restoreAll(context)
  }
}

class AlarmActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val payload = VoiceAlarmScheduler.payloadFromIntent(intent) ?: return
    when (intent.action) {
      AlarmRingingService.ACTION_SNOOZE -> VoiceAlarmScheduler.scheduleSnooze(context, payload)
      AlarmRingingService.ACTION_DONE -> VoiceAlarmScheduler.markDone(context, payload)
    }
    context.stopService(Intent(context, AlarmRingingService::class.java))
  }
}

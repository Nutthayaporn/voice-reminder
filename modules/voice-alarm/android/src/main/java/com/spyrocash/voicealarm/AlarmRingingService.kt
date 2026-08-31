package com.spyrocash.voicealarm

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.IBinder
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

class AlarmRingingService : Service() {
  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopAlarm()
      return START_NOT_STICKY
    }
    val payload = intent?.let(VoiceAlarmScheduler::payloadFromIntent) ?: return START_NOT_STICKY
    createChannel()
    startForeground(NOTIFICATION_ID, notification(payload))
    startSoundAndVibration()
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    player?.stop()
    player?.release()
    player = null
    vibrator?.cancel()
    super.onDestroy()
  }

  private fun stopAlarm() {
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(CHANNEL_ID, "นาฬิกาปลุก", NotificationManager.IMPORTANCE_HIGH).apply {
      description = "เสียงปลุกที่ดังต่อเนื่องจนกว่าจะหยุดหรือเลื่อนปลุก"
      setSound(null, null)
      enableVibration(false)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    }
    getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
  }

  private fun notification(payload: VoiceAlarmPayload): Notification {
    val fullScreen = PendingIntent.getActivity(
      this, payload.id.hashCode(), AlarmActivity.intent(this, payload),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    val primaryAction = if (payload.remindUntilDone) ACTION_DONE else ACTION_STOP
    val primary = actionIntent(primaryAction, payload, 1)
    val snooze = actionIntent(ACTION_SNOOZE, payload, 2)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID)
      else Notification.Builder(this)
    val notification = builder
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle(payload.title)
      .setContentText("รอบ ${payload.snoozeCount + 1}/${payload.maxAttempts}")
      .setCategory(Notification.CATEGORY_ALARM)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(true)
      .setAutoCancel(false)
      .setFullScreenIntent(fullScreen, true)
      .setContentIntent(fullScreen)
    if (payload.snoozeCount + 1 < payload.maxAttempts) {
      notification.addAction(
        Notification.Action.Builder(0, "เลื่อน ${payload.snoozeMinutes} นาที", snooze).build()
      )
    }
    notification.addAction(
      Notification.Action.Builder(
        0, if (payload.remindUntilDone) "ทำแล้ว" else "หยุด", primary
      ).build()
    )
    return notification.build()
  }

  private fun actionIntent(action: String, payload: VoiceAlarmPayload, offset: Int): PendingIntent {
    val intent = Intent(this, AlarmActionReceiver::class.java)
      .setAction(action)
      .putExtra(EXTRA_PAYLOAD, payload.toJson())
    return PendingIntent.getBroadcast(
      this, payload.id.hashCode() + offset, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun startSoundAndVibration() {
    if (player?.isPlaying == true) return
    val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      ?: return
    player = MediaPlayer().apply {
      setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
      )
      setDataSource(this@AlarmRingingService, uri)
      isLooping = true
      prepare()
      start()
    }
    vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      getSystemService(VibratorManager::class.java).defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    val pattern = longArrayOf(0, 500, 350, 500)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
    } else {
      @Suppress("DEPRECATION")
      vibrator?.vibrate(pattern, 0)
    }
  }

  companion object {
    const val EXTRA_PAYLOAD = "alarm_payload"
    const val ACTION_STOP = "com.spyrocash.voicealarm.STOP"
    const val ACTION_DONE = "com.spyrocash.voicealarm.DONE"
    const val ACTION_SNOOZE = "com.spyrocash.voicealarm.SNOOZE"
    private const val CHANNEL_ID = "voice_alarm_ringing"
    private const val NOTIFICATION_ID = 8701

    internal fun ringIntent(context: Context, payload: VoiceAlarmPayload) =
      Intent(context, AlarmRingingService::class.java)
        .putExtra(EXTRA_PAYLOAD, payload.toJson())

    internal fun stopIntent(context: Context) =
      Intent(context, AlarmRingingService::class.java).setAction(ACTION_STOP)
  }
}

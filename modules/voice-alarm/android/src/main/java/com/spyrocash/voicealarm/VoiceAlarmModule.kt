package com.spyrocash.voicealarm

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.util.UUID

data class ScheduleAlarmOptions(
  @Field val itemId: String,
  @Field val title: String,
  @Field val timestampMs: Double,
  @Field val frequency: String?,
  @Field val weekdays: List<String>?,
  @Field val interval: Int,
  @Field val remindUntilDone: Boolean,
  @Field val snoozeMinutes: Int,
  @Field val maxAttempts: Int
) : Record

class VoiceAlarmModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("VoiceAlarm")

    AsyncFunction("getStatusAsync") {
      val authorized = canScheduleExactAlarms(context)
      val canRequest = Build.VERSION.SDK_INT in Build.VERSION_CODES.S..Build.VERSION_CODES.S_V2
      mapOf("supported" to true, "authorized" to authorized, "canRequest" to (canRequest && !authorized))
    }

    AsyncFunction("requestAuthorizationAsync") {
      if (canScheduleExactAlarms(context)) return@AsyncFunction true
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val intent = Intent(
          Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:${context.packageName}")
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
      }
      false
    }

    AsyncFunction("scheduleAsync") { options: ScheduleAlarmOptions ->
      if (!canScheduleExactAlarms(context)) return@AsyncFunction null
      val id = UUID.randomUUID().toString()
      VoiceAlarmScheduler.schedule(
        context = context,
        id = id,
        rootId = id,
        itemId = options.itemId,
        title = options.title,
        triggerAt = options.timestampMs.toLong(),
        frequency = options.frequency,
        weekdays = options.weekdays ?: emptyList(),
        interval = options.interval.coerceAtLeast(1),
        remindUntilDone = options.remindUntilDone,
        snoozeMinutes = options.snoozeMinutes.takeIf { it == 5 || it == 10 || it == 30 } ?: 10,
        maxAttempts = options.maxAttempts.coerceIn(1, 20),
        snoozeCount = 0,
        isSnooze = false
      )
      id
    }

    AsyncFunction("cancelAsync") { identifier: String ->
      VoiceAlarmScheduler.cancel(context, identifier)
    }

    AsyncFunction("consumeCompletedItemIdsAsync") {
      VoiceAlarmScheduler.consumeCompletedItemIds(context)
    }
  }

  private fun canScheduleExactAlarms(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    return manager.canScheduleExactAlarms()
  }
}

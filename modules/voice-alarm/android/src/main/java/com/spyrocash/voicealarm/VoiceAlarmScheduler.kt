package com.spyrocash.voicealarm

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.Calendar
import java.util.TimeZone

internal data class VoiceAlarmPayload(
  val id: String,
  val rootId: String,
  val itemId: String,
  val title: String,
  val triggerAt: Long,
  val frequency: String?,
  val weekdays: List<String>,
  val interval: Int,
  val remindUntilDone: Boolean,
  val snoozeMinutes: Int,
  val maxAttempts: Int,
  val snoozeCount: Int,
  val isSnooze: Boolean
) {
  fun toJson() = JSONObject()
    .put("id", id)
    .put("rootId", rootId)
    .put("itemId", itemId)
    .put("title", title)
    .put("triggerAt", triggerAt)
    .put("frequency", frequency)
    .put("weekdays", weekdays.joinToString(","))
    .put("interval", interval)
    .put("remindUntilDone", remindUntilDone)
    .put("snoozeMinutes", snoozeMinutes)
    .put("maxAttempts", maxAttempts)
    .put("snoozeCount", snoozeCount)
    .put("isSnooze", isSnooze)
    .toString()

  companion object {
    fun fromJson(value: String): VoiceAlarmPayload {
      val json = JSONObject(value)
      val id = json.getString("id")
      return VoiceAlarmPayload(
        id = id,
        rootId = json.optString("rootId").ifBlank { id },
        itemId = json.optString("itemId").ifBlank { id },
        title = json.getString("title"),
        triggerAt = json.getLong("triggerAt"),
        frequency = json.optString("frequency").takeIf { it.isNotBlank() && it != "null" },
        weekdays = json.optString("weekdays").split(',').filter { it.isNotBlank() },
        interval = json.optInt("interval", 1).coerceAtLeast(1),
        remindUntilDone = json.optBoolean("remindUntilDone", false),
        snoozeMinutes = json.optInt("snoozeMinutes", 10).takeIf { it == 5 || it == 10 || it == 30 } ?: 10,
        maxAttempts = json.optInt("maxAttempts", 5).coerceIn(1, 20),
        snoozeCount = json.optInt("snoozeCount", 0).coerceAtLeast(0),
        isSnooze = json.optBoolean("isSnooze", false)
      )
    }
  }
}

internal object VoiceAlarmScheduler {
  private const val PREFS = "voice_alarm_schedules"
  private const val COMPLETION_PREFS = "voice_alarm_completions"
  private const val COMPLETED_IDS = "completed_item_ids"
  private val timezone = TimeZone.getTimeZone("Asia/Bangkok")

  fun schedule(
    context: Context,
    id: String,
    rootId: String,
    itemId: String,
    title: String,
    triggerAt: Long,
    frequency: String?,
    weekdays: List<String>,
    interval: Int,
    remindUntilDone: Boolean,
    snoozeMinutes: Int,
    maxAttempts: Int,
    snoozeCount: Int,
    isSnooze: Boolean
  ) {
    val payload = VoiceAlarmPayload(
      id, rootId, itemId, title, triggerAt, frequency, weekdays, interval,
      remindUntilDone, snoozeMinutes, maxAttempts, snoozeCount, isSnooze
    )
    schedulePayload(context, payload, persist = true)
  }

  fun cancel(context: Context, rootId: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val matching = prefs.all.mapNotNull { (_, raw) ->
      (raw as? String)?.let { runCatching { VoiceAlarmPayload.fromJson(it) }.getOrNull() }
    }.filter { it.rootId == rootId || it.id == rootId }
    matching.forEach { cancelPayload(context, it) }
    val editor = prefs.edit()
    matching.forEach { editor.remove(it.id) }
    editor.apply()
  }

  fun scheduleSnooze(context: Context, payload: VoiceAlarmPayload): Boolean {
    // maxAttempts includes the first ring, so five attempts permit four snoozes.
    if (payload.snoozeCount + 1 >= payload.maxAttempts) return false
    cancelSnoozes(context, payload.rootId)
    val nextCount = payload.snoozeCount + 1
    val id = "${payload.rootId}:snooze:$nextCount:${System.currentTimeMillis()}"
    schedule(
      context = context,
      id = id,
      rootId = payload.rootId,
      itemId = payload.itemId,
      title = payload.title,
      triggerAt = System.currentTimeMillis() + payload.snoozeMinutes * 60_000L,
      frequency = null,
      weekdays = emptyList(),
      interval = 1,
      remindUntilDone = payload.remindUntilDone,
      snoozeMinutes = payload.snoozeMinutes,
      maxAttempts = payload.maxAttempts,
      snoozeCount = nextCount,
      isSnooze = true
    )
    return true
  }

  fun markDone(context: Context, payload: VoiceAlarmPayload) {
    cancelSnoozes(context, payload.rootId)
    val prefs = context.getSharedPreferences(COMPLETION_PREFS, Context.MODE_PRIVATE)
    val completed = prefs.getStringSet(COMPLETED_IDS, emptySet()).orEmpty().toMutableSet()
    completed.add(payload.itemId)
    prefs.edit().putStringSet(COMPLETED_IDS, completed).apply()
  }

  fun consumeCompletedItemIds(context: Context): List<String> {
    val prefs = context.getSharedPreferences(COMPLETION_PREFS, Context.MODE_PRIVATE)
    val completed = prefs.getStringSet(COMPLETED_IDS, emptySet()).orEmpty().toList()
    if (completed.isNotEmpty()) prefs.edit().remove(COMPLETED_IDS).apply()
    return completed
  }

  fun afterFire(context: Context, id: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val value = prefs.getString(id, null) ?: return
    val payload = VoiceAlarmPayload.fromJson(value)
    if (payload.isSnooze || payload.frequency == null) {
      prefs.edit().remove(id).apply()
      return
    }
    val next = nextTrigger(payload.triggerAt, payload.frequency, payload.weekdays, payload.interval)
    schedulePayload(context, payload.copy(triggerAt = next), persist = true)
  }

  fun restoreAll(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    for ((id, raw) in prefs.all) {
      val value = raw as? String ?: continue
      runCatching {
        var payload = VoiceAlarmPayload.fromJson(value)
        if (payload.triggerAt <= System.currentTimeMillis()) {
          payload = if (!payload.isSnooze && payload.frequency != null) {
            payload.copy(
              triggerAt = nextTrigger(
                payload.triggerAt, payload.frequency, payload.weekdays, payload.interval
              )
            )
          } else {
            // A clock alarm missed during reboot should ring shortly after restore.
            payload.copy(triggerAt = System.currentTimeMillis() + 3_000L)
          }
        }
        schedulePayload(context, payload, persist = true)
      }.onFailure { prefs.edit().remove(id).apply() }
    }
  }

  fun payloadFromIntent(intent: Intent): VoiceAlarmPayload? {
    val raw = intent.getStringExtra(AlarmRingingService.EXTRA_PAYLOAD) ?: return null
    return runCatching { VoiceAlarmPayload.fromJson(raw) }.getOrNull()
  }

  private fun schedulePayload(context: Context, payload: VoiceAlarmPayload, persist: Boolean) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val operation = ringIntent(context, payload)
    val showIntent = PendingIntent.getActivity(
      context,
      payload.id.hashCode(),
      AlarmActivity.intent(context, payload),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
    manager.setAlarmClock(AlarmManager.AlarmClockInfo(payload.triggerAt, showIntent), operation)
    if (persist) {
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit().putString(payload.id, payload.toJson()).apply()
    }
  }

  private fun cancelSnoozes(context: Context, rootId: String) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val matching = prefs.all.mapNotNull { (_, raw) ->
      (raw as? String)?.let { runCatching { VoiceAlarmPayload.fromJson(it) }.getOrNull() }
    }.filter { it.rootId == rootId && it.isSnooze }
    matching.forEach { cancelPayload(context, it) }
    val editor = prefs.edit()
    matching.forEach { editor.remove(it.id) }
    editor.apply()
  }

  private fun cancelPayload(context: Context, payload: VoiceAlarmPayload) {
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(ringIntent(context, payload))
  }

  private fun ringIntent(context: Context, payload: VoiceAlarmPayload): PendingIntent {
    val intent = Intent(context, AlarmReceiver::class.java)
      .setAction("com.spyrocash.voicealarm.RING.${payload.id}")
      .putExtra(AlarmRingingService.EXTRA_PAYLOAD, payload.toJson())
    return PendingIntent.getBroadcast(
      context,
      payload.id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun nextTrigger(current: Long, frequency: String, weekdays: List<String>, interval: Int): Long {
    val calendar = Calendar.getInstance(timezone).apply { timeInMillis = current }
    do {
      when (frequency) {
        "daily" -> calendar.add(Calendar.DAY_OF_YEAR, interval)
        "weekly" -> {
          if (weekdays.isEmpty()) calendar.add(Calendar.WEEK_OF_YEAR, interval)
          else {
            do calendar.add(Calendar.DAY_OF_YEAR, 1)
            while (weekdayCode(calendar.get(Calendar.DAY_OF_WEEK)) !in weekdays)
          }
        }
        "monthly" -> calendar.add(Calendar.MONTH, interval)
        "yearly" -> calendar.add(Calendar.YEAR, interval)
        else -> calendar.add(Calendar.DAY_OF_YEAR, interval)
      }
    } while (calendar.timeInMillis <= System.currentTimeMillis())
    return calendar.timeInMillis
  }

  private fun weekdayCode(day: Int): String = when (day) {
    Calendar.SUNDAY -> "SU"
    Calendar.MONDAY -> "MO"
    Calendar.TUESDAY -> "TU"
    Calendar.WEDNESDAY -> "WE"
    Calendar.THURSDAY -> "TH"
    Calendar.FRIDAY -> "FR"
    Calendar.SATURDAY -> "SA"
    else -> "MO"
  }
}

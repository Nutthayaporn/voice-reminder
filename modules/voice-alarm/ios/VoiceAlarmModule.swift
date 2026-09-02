import ExpoModulesCore
import Foundation

private struct ScheduleAlarmOptions: Record {
  @Field var itemId: String
  @Field var title: String
  @Field var timestampMs: Double
  @Field var frequency: String?
  @Field var weekdays: [String]?
  @Field var interval: Int
  @Field var remindUntilDone: Bool
  @Field var snoozeMinutes: Int
  @Field var maxAttempts: Int
}

#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import SwiftUI

@available(iOS 26.0, *)
private struct VoiceReminderAlarmMetadata: AlarmMetadata {
  let source: String
  let itemID: String
}

private enum VoiceReminderCompletionStore {
  private static let key = "voice-reminder.completed-alarm-item-ids"

  static func mark(_ itemID: String) {
    var ids = Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
    ids.insert(itemID)
    UserDefaults.standard.set(Array(ids), forKey: key)
  }

  static func consume() -> [String] {
    let ids = UserDefaults.standard.stringArray(forKey: key) ?? []
    UserDefaults.standard.removeObject(forKey: key)
    return ids
  }
}

@available(iOS 26.0, *)
private struct MarkReminderDoneIntent: LiveActivityIntent {
  static var title: LocalizedStringResource = "Mark reminder as done"
  static var openAppWhenRun = false

  @Parameter(title: "Reminder ID")
  var itemID: String

  init() {
    itemID = ""
  }

  init(itemID: String) {
    self.itemID = itemID
  }

  func perform() async throws -> some IntentResult {
    VoiceReminderCompletionStore.mark(itemID)
    return .result()
  }
}
#endif

public final class VoiceAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VoiceAlarm")

    AsyncFunction("getStatusAsync") { () -> [String: Bool] in
      guard #available(iOS 26.0, *) else {
        return ["supported": false, "authorized": false, "canRequest": false]
      }
#if canImport(AlarmKit)
      let state = AlarmManager.shared.authorizationState
      return [
        "supported": true,
        "authorized": state == .authorized,
        "canRequest": state == .notDetermined
      ]
#else
      return ["supported": false, "authorized": false, "canRequest": false]
#endif
    }

    AsyncFunction("requestAuthorizationAsync") { () async throws -> Bool in
      guard #available(iOS 26.0, *) else { return false }
#if canImport(AlarmKit)
      return try await AlarmManager.shared.requestAuthorization() == .authorized
#else
      return false
#endif
    }

    AsyncFunction("scheduleAsync") { (options: ScheduleAlarmOptions) async throws -> String? in
      guard #available(iOS 26.0, *) else { return nil }
#if canImport(AlarmKit)
      guard AlarmManager.shared.authorizationState == .authorized else { return nil }
      // AlarmKit currently supports one-shot and weekly cadence. Monthly/yearly
      // (and interval > 1) deliberately fall back to expo-notifications in JS.
      guard options.interval == 1,
        options.frequency == nil || options.frequency == "daily" || options.frequency == "weekly"
      else {
        return nil
      }

      let fireDate = Date(timeIntervalSince1970: options.timestampMs / 1000)
      guard fireDate > Date() || options.frequency != nil else { return nil }
      let schedule: Alarm.Schedule
      if let frequency = options.frequency {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Bangkok") ?? .current
        let parts = calendar.dateComponents([.hour, .minute], from: fireDate)
        let time = Alarm.Schedule.Relative.Time(hour: parts.hour ?? 0, minute: parts.minute ?? 0)
        let days: [Locale.Weekday]
        if frequency == "daily" {
          days = [.sunday, .monday, .tuesday, .wednesday, .thursday, .friday, .saturday]
        } else {
          days = (options.weekdays ?? []).compactMap(Self.weekday)
        }
        guard !days.isEmpty else { return nil }
        schedule = .relative(.init(time: time, repeats: .weekly(days)))
      } else {
        schedule = .fixed(fireDate)
      }

      let titleResource = LocalizedStringResource(stringLiteral: options.title)
      let validSnoozeMinutes = [5, 10, 30].contains(options.snoozeMinutes) ? options.snoozeMinutes : 10
      _ = options.maxAttempts // AlarmKit owns Repeat and doesn't expose a dynamic repeat cap.
      let repeatButton = AlarmButton(
        text: LocalizedStringResource(stringLiteral: "Snooze \(validSnoozeMinutes) min"),
        textColor: Color.cyan,
        systemImageName: "zzz"
      )
      let alert: AlarmPresentation.Alert
      if #available(iOS 26.1, *) {
        alert = AlarmPresentation.Alert(
          title: titleResource,
          secondaryButton: repeatButton,
          secondaryButtonBehavior: .countdown
        )
      } else {
        let stopButton = AlarmButton(
          text: LocalizedStringResource(stringLiteral: options.remindUntilDone ? "Done" : "Stop"),
          textColor: Color.white,
          systemImageName: "stop.fill"
        )
        alert = AlarmPresentation.Alert(
          title: titleResource,
          stopButton: stopButton,
          secondaryButton: repeatButton,
          secondaryButtonBehavior: .countdown
        )
      }
      // Keep countdown presentation nil: Repeat still uses postAlert, while a
      // custom countdown Live Activity would require a separate Widget target.
      let presentation = AlarmPresentation(alert: alert)
      let attributes = AlarmAttributes(
        presentation: presentation,
        metadata: VoiceReminderAlarmMetadata(source: "voice-reminder", itemID: options.itemId),
        tintColor: Color.cyan
      )
      let configuration = AlarmManager.AlarmConfiguration(
        countdownDuration: Alarm.CountdownDuration(
          preAlert: nil,
          postAlert: TimeInterval(validSnoozeMinutes * 60)
        ),
        schedule: schedule,
        attributes: attributes,
        stopIntent: options.remindUntilDone ? MarkReminderDoneIntent(itemID: options.itemId) : nil
      )
      let id = UUID()
      _ = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
      return id.uuidString
#else
      return nil
#endif
    }

    AsyncFunction("cancelAsync") { (identifier: String) throws in
      guard #available(iOS 26.0, *), let id = UUID(uuidString: identifier) else { return }
#if canImport(AlarmKit)
      try AlarmManager.shared.cancel(id: id)
#endif
    }

    AsyncFunction("consumeCompletedItemIdsAsync") { () -> [String] in
#if canImport(AlarmKit)
      return VoiceReminderCompletionStore.consume()
#else
      return []
#endif
    }
  }

#if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private static func weekday(_ code: String) -> Locale.Weekday? {
    switch code {
    case "SU": return .sunday
    case "MO": return .monday
    case "TU": return .tuesday
    case "WE": return .wednesday
    case "TH": return .thursday
    case "FR": return .friday
    case "SA": return .saturday
    default: return nil
    }
  }
#endif
}

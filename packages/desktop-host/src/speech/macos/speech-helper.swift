// Native helper protocol: check <locale>; transcribe <audio-path> <locale>.
// Stdout contains structured JSON. Recognition always stays on-device.
// The capability probe reads current authorization without prompting; a real
// transcription request can request Speech authorization. CLI callbacks need
// the main run loop pumped rather than a blocking semaphore.
import Foundation
import Speech
// Keep Speech in a small native subprocess so the JavaScript desktop host need not link Swift
// or a speech framework. JSON-only stdout gives it a stable machine protocol instead of prose.
// On-device recognition is a privacy requirement: missing locale assets must fail, never cause
// a transparent retry that uploads the recorded audio for network recognition.

/// Speech callbacks arrive via XPC onto the main queue. A bare CLI has no application loop;
/// blocking that thread on a semaphore starves its own callbacks and repeatedly hits the 30s
/// recognition timeout. Pumping the run loop keeps the queue alive between completion checks.
func spinRunLoop(until isDone: () -> Bool, timeoutSeconds: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while !isDone() {
        if Date() > deadline { return false }
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
    }
    return true
}
func resolveSpeechAuthorization() -> SFSpeechRecognizerAuthorizationStatus {
    var status: SFSpeechRecognizerAuthorizationStatus = .notDetermined
    var received = false
    SFSpeechRecognizer.requestAuthorization { result in
        status = result
        received = true
    }
    _ = spinRunLoop(until: { received }, timeoutSeconds: 15)
    return status
}
// Authorization prose is for human diagnostics; the host branches on available/ok, not these labels.
func describeAuthStatus(_ status: SFSpeechRecognizerAuthorizationStatus) -> String {
    switch status {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .restricted: return "restricted"
    case .notDetermined: return "not-determined"
    @unknown default: return "unknown"
    }
}
// Fixed-shape JSON payloads with one variable string need escaping, without a heavier JSON dependency.
func jsonEscape(_ text: String) -> String {
    var result = ""
    for scalar in text.unicodeScalars {
        switch scalar {
        case "\"": result += "\\\""
        case "\\": result += "\\\\"
        case "\n": result += "\\n"
        case "\r": result += "\\r"
        case "\t": result += "\\t"
        default:
            if scalar.value < 0x20 {
                result += String(format: "\\u%04x", scalar.value)
            } else {
                result.unicodeScalars.append(scalar)
            }
        }
    }
    return result
}
// A capability check reads authorization/assets without a microphone or audio file, letting the
// host decide whether to offer recording before starting recognition or prompting the user.
func runCheck(locale: String) -> Never {
    let status = SFSpeechRecognizer.authorizationStatus()
    guard status == .authorized else {
        print("{\"available\":false,\"reason\":\"speech-recognition-not-authorized:\(describeAuthStatus(status))\"}")
        exit(0)
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
        print("{\"available\":false,\"reason\":\"no-recognizer-for-locale\"}")
        exit(0)
    }
    if !recognizer.supportsOnDeviceRecognition {
        print("{\"available\":false,\"reason\":\"on-device-recognition-unavailable\"}")
        exit(0)
    }
    print("{\"available\":true,\"reason\":null}")
    exit(0)
}
func runTranscribe(path: String, locale: String) -> Never {
    let status = resolveSpeechAuthorization()
    guard status == .authorized else {
        print("{\"ok\":false,\"error\":\"speech-recognition-not-authorized:\(describeAuthStatus(status))\"}")
        exit(1)
    }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: locale)) else {
        print("{\"ok\":false,\"error\":\"no-recognizer-for-locale\"}")
        exit(1)
    }
    guard recognizer.supportsOnDeviceRecognition else {
        print("{\"ok\":false,\"error\":\"on-device-recognition-unavailable\"}")
        exit(1)
    }

    let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: path))
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false

    let start = Date()
    var finalText: String?
    var finalError: Error?
    var finished = false
    let task = recognizer.recognitionTask(with: request) { result, error in
        if let error = error {
            finalError = error
            finished = true
            return
        }
        if let result = result, result.isFinal {
            finalText = result.bestTranscription.formattedString
            finished = true
        }
    }
    _ = task

    let completed = spinRunLoop(until: { finished }, timeoutSeconds: 30)
    let elapsedMs = Int(Date().timeIntervalSince(start) * 1000)

    if !completed {
        task.cancel()
        print("{\"ok\":false,\"error\":\"timed-out-after-\(elapsedMs)ms\"}")
        exit(1)
    }
    if let error = finalError {
        print("{\"ok\":false,\"error\":\"\(jsonEscape(error.localizedDescription))\"}")
        exit(1)
    }
    print("{\"ok\":true,\"text\":\"\(jsonEscape(finalText ?? ""))\",\"elapsedMs\":\(elapsedMs)}")
    exit(0)
}

let arguments = CommandLine.arguments
guard arguments.count > 1 else {
    print("{\"ok\":false,\"error\":\"usage: speech-helper check|transcribe <path>\"}")
    exit(2)
}

switch arguments[1] {
case "check":
    guard arguments.count > 2 else {
        print("{\"available\":false,\"reason\":\"locale-required\"}")
        exit(2)
    }
    runCheck(locale: arguments[2])
case "transcribe":
    guard arguments.count > 3 else {
        print("{\"ok\":false,\"error\":\"usage: speech-helper transcribe <path-to-audio-file> <locale>\"}")
        exit(2)
    }
    runTranscribe(path: arguments[2], locale: arguments[3])
default:
    print("{\"ok\":false,\"error\":\"unknown subcommand: \(arguments[1])\"}")
    exit(2)
}

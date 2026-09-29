import Foundation
import Vision
import AppKit

/**
 Records what the app's own reader sees in an image, as the `OcrPage` JSON the
 parser consumes.

 This is the bridge that makes the parser testable. The phone reads a photograph
 through `PageReader`; this compiles that very file and runs it on a Mac over a
 saved photo, so a fixture in `src/import/image/fixtures` is not an
 approximation of what the device will see — it is the same code on the same
 bytes. Adding a page to the test suite costs one command and no simulator.
 */

let arguments = CommandLine.arguments
guard arguments.count > 1,
      let image = NSImage(contentsOfFile: arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    FileHandle.standardError.write("usage: main <image> [--raw] [language...]\n".data(using: .utf8)!)
    exit(1)
}

// `--raw` records what Vision sees with no flattening at all. Kept so the suite
// can hold a fixture proving what the preprocessing is worth.
let rest = Array(arguments.dropFirst(2))
let raw = rest.contains("--raw")
let named = rest.filter { $0 != "--raw" }
let languages = named.isEmpty ? ["fr-FR", "en-US"] : named

let page = try PageReader.read(cgImage, languages: languages, flatten: !raw)

// Rounded on the way out: a fixture is read by people as often as by the suite,
// and full double precision makes it unreadable without making it truer.
func rounded(_ value: Any, _ places: Double) -> Any {
    guard let number = value as? Double else { return value }
    let scale = pow(10, places)
    return (number * scale).rounded() / scale
}
let lines = (page["lines"] as? [[String: Any]] ?? []).map { line -> [String: Any] in
    var copy = line
    for key in ["x", "y", "width", "height"] { copy[key] = rounded(line[key] ?? 0, 4) }
    copy["confidence"] = rounded(line["confidence"] ?? 0, 3)
    copy["angle"] = rounded(line["angle"] ?? 0, 3)
    return copy
}

let output: [String: Any] = ["width": page["width"] ?? 0, "height": page["height"] ?? 0, "lines": lines]
let data = try JSONSerialization.data(withJSONObject: output,
                                      options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)

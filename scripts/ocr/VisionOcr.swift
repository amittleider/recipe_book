import Foundation
import Vision
import AppKit

/**
 Records what Apple Vision reads in an image, as the `OcrPage` JSON the parser consumes.

 This is the bridge that makes the parser testable. The phone runs Vision through
 the app's native module; this runs the same framework on a Mac over a saved
 photo, so a fixture in `src/import/image/fixtures` is not an approximation of
 what the device will see — it is the same engine on the same bytes. Adding a
 page to the test suite therefore costs one command and no simulator.

 Coordinates are normalised 0..1 with the origin at the top left, matching
 `src/ocr/types.ts`. Vision itself reports a bottom-left origin; it is flipped
 here so that fixtures, the iOS module and the parser all agree.
 */

let arguments = CommandLine.arguments
guard arguments.count > 1,
      let image = NSImage(contentsOfFile: arguments[1]),
      let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil)
else {
    FileHandle.standardError.write("usage: VisionOcr <image> [language...]\n".data(using: .utf8)!)
    exit(1)
}

let languages = arguments.count > 2 ? Array(arguments[2...]) : ["fr-FR", "en-US"]

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = languages
// The cookbook is French and full of words a generic model will not propose;
// correction is still worth more than it costs on printed type.
request.usesLanguageCorrection = true

try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])

let lines: [[String: Any]] = (request.results ?? []).compactMap { observation in
    guard let best = observation.topCandidates(1).first else { return nil }
    let box = observation.boundingBox
    return [
        "text": best.string,
        "x": round(Double(box.minX) * 10000) / 10000,
        "y": round(Double(1 - box.maxY) * 10000) / 10000,
        "width": round(Double(box.width) * 10000) / 10000,
        "height": round(Double(box.height) * 10000) / 10000,
        "confidence": round(Double(best.confidence) * 1000) / 1000,
    ]
}

let page: [String: Any] = ["width": cgImage.width, "height": cgImage.height, "lines": lines]
let data = try JSONSerialization.data(withJSONObject: page, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)

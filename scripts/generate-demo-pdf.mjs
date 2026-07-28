import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../public/demo-paper.pdf");
const pdf = await PDFDocument.create();
pdf.setTitle("Stability Margins in Feedback Systems");
pdf.setAuthor("Margin Demo Laboratory");
pdf.setSubject("A selectable demo paper for the Margin PDF reader");
const metadataDate = new Date("2026-01-01T00:00:00.000Z");
pdf.setCreationDate(metadataDate);
pdf.setModificationDate(metadataDate);

const times = await pdf.embedFont(StandardFonts.TimesRoman);
const timesBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
const timesItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

const pageSize = [612, 792];
const ink = rgb(0.12, 0.16, 0.15);
const softInk = rgb(0.31, 0.35, 0.33);
const accent = rgb(0.55, 0.27, 0.12);
const pale = rgb(0.94, 0.92, 0.87);

function wrapText(text, font, size, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawWrapped(page, text, options) {
  const {
    x,
    y,
    width,
    font = times,
    size = 10.2,
    lineHeight = 14,
    color = softInk,
    maxLines = Number.POSITIVE_INFINITY
  } = options;
  const lines = wrapText(text, font, size, width).slice(0, maxLines);
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color
    });
  });
  return y - lines.length * lineHeight;
}

function drawHeader(page, pageNumber) {
  page.drawText("JOURNAL OF CONTROL & SYSTEMS  /  TEACHING NOTE", {
    x: 54,
    y: 758,
    size: 7.2,
    font: helveticaBold,
    color: rgb(0.39, 0.42, 0.4),
    characterSpacing: 0.8
  });
  page.drawText(String(pageNumber), {
    x: 550,
    y: 758,
    size: 8,
    font: helvetica,
    color: rgb(0.39, 0.42, 0.4)
  });
  page.drawLine({
    start: { x: 54, y: 749 },
    end: { x: 558, y: 749 },
    thickness: 0.6,
    color: rgb(0.74, 0.73, 0.69)
  });
}

function drawSection(page, title, y) {
  page.drawText(title.toUpperCase(), {
    x: 54,
    y,
    size: 9.2,
    font: helveticaBold,
    color: accent,
    characterSpacing: 0.45
  });
  return y - 20;
}

function drawEquation(page, expression, y) {
  const width = timesItalic.widthOfTextAtSize(expression, 13);
  page.drawRectangle({
    x: 54,
    y: y - 14,
    width: 504,
    height: 40,
    color: rgb(0.965, 0.96, 0.94)
  });
  page.drawText(expression, {
    x: 306 - width / 2,
    y,
    size: 13,
    font: timesItalic,
    color: ink
  });
  return y - 38;
}

function drawFooter(page, label) {
  page.drawLine({
    start: { x: 54, y: 38 },
    end: { x: 558, y: 38 },
    thickness: 0.5,
    color: rgb(0.78, 0.77, 0.73)
  });
  page.drawText(label, {
    x: 54,
    y: 24,
    size: 7,
    font: helvetica,
    color: rgb(0.46, 0.48, 0.46)
  });
}

{
  const page = pdf.addPage(pageSize);
  drawHeader(page, 1);

  page.drawText("Stability Margins in", {
    x: 54,
    y: 694,
    size: 27,
    font: timesBold,
    color: ink
  });
  page.drawText("Feedback Systems", {
    x: 54,
    y: 661,
    size: 27,
    font: timesBold,
    color: ink
  });
  page.drawText("A geometric reading of robustness for practicing engineers", {
    x: 54,
    y: 630,
    size: 12,
    font: timesItalic,
    color: accent
  });
  page.drawText("A. Raman   /   M. Chen   /   Systems Laboratory", {
    x: 54,
    y: 602,
    size: 8.3,
    font: helvetica,
    color: rgb(0.37, 0.4, 0.38)
  });

  page.drawRectangle({
    x: 54,
    y: 459,
    width: 504,
    height: 112,
    color: pale
  });
  page.drawText("ABSTRACT", {
    x: 68,
    y: 548,
    size: 8.5,
    font: helveticaBold,
    color: accent
  });
  drawWrapped(
    page,
    "Robust stability describes a feedback system's ability to remain stable when its mathematical model is only approximately known. This note connects gain and phase margins to a geometric interpretation of uncertainty. The central claim is that a nominally stable loop is not necessarily a useful design: it must also be far enough from instability to tolerate modeling error, delay, and component drift.",
    {
      x: 68,
      y: 526,
      width: 476,
      size: 10,
      lineHeight: 14,
      color: ink
    }
  );

  let y = drawSection(page, "1. The closed-loop question", 422);
  y = drawWrapped(
    page,
    "Consider a plant G(s), controller C(s), and feedback path H(s). Their product L(s) = C(s)G(s)H(s) is the loop transfer function. Closing the loop changes the transfer from reference to output because the measured output is subtracted from the command.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 18;
  y = drawEquation(page, "T(s) = C(s)G(s) / [1 + C(s)G(s)H(s)]", y);
  y -= 7;
  y = drawWrapped(
    page,
    "The denominator contains the characteristic equation. Its roots are the closed-loop poles, and their locations determine whether disturbances decay or grow over time. A design is internally stable only when every hidden mode is stable, not merely when one measured input-output path looks bounded.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 8;
  drawWrapped(
    page,
    "The important engineering question is therefore not simply whether 1 + L(s) is nonzero for the nominal model. We ask how much L(s) may change before that condition fails. The distance from the critical condition is a practical measure of robustness.",
    {
      x: 54,
      y,
      width: 504,
      size: 10.4,
      lineHeight: 14.8,
      color: ink
    }
  );

  drawFooter(page, "Margin demo paper  /  locally generated sample");
}

{
  const page = pdf.addPage(pageSize);
  drawHeader(page, 2);
  let y = drawSection(page, "2. Geometry of the critical point", 710);
  y = drawWrapped(
    page,
    "For a unity-feedback loop, the frequency-domain critical condition is L(jw) = -1. The Nyquist curve traces the complex value of L(jw) as frequency changes. Its encirclements of -1, combined with the open-loop unstable poles, determine the number of unstable closed-loop poles.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 9;
  y = drawWrapped(
    page,
    "This result is deeper than a graphical recipe. The complex number 1 + L(jw) is the closed-loop denominator evaluated along the frequency axis. When the Nyquist curve approaches -1, that denominator approaches zero. The closed loop then amplifies some disturbances sharply and becomes sensitive to small model errors.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 20;
  y = drawEquation(page, "S(s) = 1 / [1 + L(s)]", y);
  y -= 8;
  y = drawWrapped(
    page,
    "The sensitivity function S(s) quantifies this amplification. At each frequency, |S(jw)| is the reciprocal of the distance from L(jw) to -1. A small geometric distance therefore means large sensitivity. This is why robustness, disturbance rejection, and the shape of the Nyquist curve are different views of the same denominator.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );

  y -= 13;
  y = drawSection(page, "3. Gain margin and phase margin", y);
  y = drawWrapped(
    page,
    "Gain margin asks how much the loop magnitude can be multiplied before the curve reaches -1 at the phase-crossing frequency. Phase margin asks how much additional phase lag can be inserted at the gain-crossing frequency before the same event occurs. Both are one-dimensional probes of a two-dimensional geometric separation.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 9;
  y = drawWrapped(
    page,
    "A large phase margin often correlates with a well-damped transient response, but it is not itself a damping ratio. The familiar correspondence depends on a dominant second-order shape, modest higher-order dynamics, and the absence of troublesome zeros. When those assumptions fail, the numerical margin can remain comfortable while the time response is still poor.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 9;
  drawWrapped(
    page,
    "Classical margins are best treated as interpretable design summaries rather than universal certificates. Disk margins and structured singular-value methods generalize the same question when gain and phase vary together or uncertainty has a known multivariable structure.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );

  drawFooter(page, "Stability Margins in Feedback Systems  /  2");
}

{
  const page = pdf.addPage(pageSize);
  drawHeader(page, 3);
  let y = drawSection(page, "4. Worked interpretation", 710);
  y = drawWrapped(
    page,
    "Suppose a loop crosses unit magnitude near 12 rad/s with phase -132 degrees. The phase margin is approximately 48 degrees. If a neglected actuator pole contributes another 20 degrees of lag near crossover, the remaining margin is about 28 degrees. The nominal model has not changed its stability classification, but the plausible implementation is now much closer to oscillation.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 13;
  page.drawRectangle({
    x: 74,
    y: y - 95,
    width: 464,
    height: 105,
    borderColor: rgb(0.69, 0.55, 0.39),
    borderWidth: 0.8,
    color: rgb(0.98, 0.96, 0.91)
  });
  page.drawText("ENGINEERING READING", {
    x: 90,
    y: y - 18,
    size: 8.5,
    font: helveticaBold,
    color: accent
  });
  drawWrapped(
    page,
    "The margin is not spare performance waiting to be spent. It is a budget for everything the nominal model omitted: delay, flexible modes, sampling, thermal drift, calibration error, and cross-coupling. Spending that budget should be an explicit design decision.",
    {
      x: 90,
      y: y - 40,
      width: 432,
      size: 10.2,
      lineHeight: 14.5,
      color: ink
    }
  );
  y -= 128;
  y = drawSection(page, "5. What a margin does not prove", y);
  y = drawWrapped(
    page,
    "First, a single-loop margin does not certify a multivariable system against simultaneous channel interactions. Second, a frequency-domain stability margin says little about saturation, rate limits, quantization, or nonlinear operating-point changes. Third, a large nominal margin can coexist with poor low-frequency disturbance rejection or excessive high-frequency noise amplification.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 9;
  y = drawWrapped(
    page,
    "Good design therefore combines several views: closed-loop pole locations, sensitivity peaks, complementary-sensitivity roll-off, actuator effort, time-domain simulations, and uncertainty models. Margins remain valuable because they compress a difficult geometric question into numbers that engineers can discuss and compare.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );
  y -= 14;
  y = drawSection(page, "6. Summary", y);
  drawWrapped(
    page,
    "Feedback stability is governed by the denominator 1 + L(s). Classical gain and phase margins measure specific routes by which the frequency response can approach its critical value. Their real meaning is robustness: distance from a nominal design to a physically plausible failure. Use the numbers as compact evidence, and always state the uncertainty and performance assumptions that make them relevant.",
    { x: 54, y, width: 504, size: 10.4, lineHeight: 14.8, color: ink }
  );

  drawFooter(page, "Stability Margins in Feedback Systems  /  3");
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, await pdf.save());
console.log(`Generated ${outputPath}`);

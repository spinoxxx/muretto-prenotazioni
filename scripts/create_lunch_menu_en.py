from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "menu-del-pranzo-en.pdf"
LOGO = ROOT / "public" / "muretto-logo.png"

PAGE_WIDTH, PAGE_HEIGHT = A4
GREEN = HexColor("#536763")
TEXT = HexColor("#333333")
MUTED = HexColor("#5d5d5d")


def center_text(pdf, text, y, font, size, color=TEXT):
    pdf.setFont(font, size)
    pdf.setFillColor(color)
    pdf.drawCentredString(PAGE_WIDTH / 2, y, text)


def fit_centered_text(pdf, text, y, font, size, max_width, color=TEXT):
    current_size = size
    while stringWidth(text, font, current_size) > max_width and current_size > 8:
        current_size -= 0.25
    center_text(pdf, text, y, font, current_size, color)


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_WIDTH, PAGE_HEIGHT))
    pdf.setTitle("Muretto - Daily Menu")
    pdf.setAuthor("Muretto")
    pdf.setFillColor(white)
    pdf.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)

    if LOGO.exists():
        pdf.drawImage(str(LOGO), 220, 730, width=155, height=43, mask="auto", preserveAspectRatio=True, anchor="c")
    center_text(pdf, "TASTE THE MOMENT.", 721, "Helvetica", 5.5, MUTED)
    center_text(pdf, "DAILY MENU", 670, "Times-Roman", 25, GREEN)

    center_text(pdf, "FIRST COURSE OF YOUR CHOICE", 590, "Times-Roman", 15, GREEN)
    center_text(pdf, "PASTA WITH SCAMPI SAUCE", 552, "Helvetica", 9.5)
    center_text(pdf, "PARMESAN RISOTTO", 520, "Helvetica", 9.5)
    center_text(pdf, "PASTA WITH ZUCCHINI AND SPECK", 488, "Helvetica", 9.5)

    center_text(pdf, "MAIN COURSE OF YOUR CHOICE", 435, "Times-Roman", 15, GREEN)
    center_text(pdf, "OMELETTE WITH HAM AND MOZZARELLA", 397, "Helvetica", 9.5)
    center_text(pdf, "WHITE WINE ESCALOPES", 365, "Helvetica", 9.5)
    center_text(pdf, "OSSO BUCO", 333, "Helvetica", 9.5)

    pdf.setFillColor(TEXT)
    pdf.setFont("Helvetica", 8.5)
    pdf.drawString(80, 278, "SIDE DISHES OF YOUR CHOICE:")
    pdf.drawString(80, 264, "OVEN-BAKED POTATOES OR VEGETABLE RATATOUILLE")

    pdf.setFillColor(GREEN)
    pdf.rect(80, 120, 435, 115, fill=1, stroke=0)
    center_text(pdf, "ONE COURSE", 194, "Times-Roman", 15, white)
    center_text(pdf, "TWO COURSES", 156, "Times-Roman", 15, white)
    pdf.setFont("Times-Bold", 13)
    pdf.setFillColor(white)
    pdf.drawString(405, 194, "€14")
    pdf.drawString(405, 156, "€20")
    pdf.setFont("Helvetica", 7.5)
    pdf.drawString(215, 134, "water, coffee and cover charge included")

    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 6.8)
    footer_left = [
        "* Products marked with an asterisk may have",
        "been previously frozen after blast chilling.",
        "Dishes may contain traces of allergens due to",
        "cross-contamination.",
    ]
    for index, line in enumerate(footer_left):
        pdf.drawString(80, 62 - index * 9, line)

    pdf.setFont("Helvetica", 5.8)
    allergens = [
        "1 gluten - 2 crustaceans", "9 celery - 10 mustard",
        "3 eggs - 4 fish", "11 sesame seeds",
        "5 peanuts - 6 soy", "12 sulphur dioxide",
        "7 milk - 8 nuts", "13 lupin - 14 molluscs",
    ]
    for index, line in enumerate(allergens):
        x = 365 if index % 2 == 0 else 470
        y = 62 - (index // 2) * 9
        pdf.drawString(x, y, line)

    if LOGO.exists():
        pdf.drawImage(str(LOGO), 258, 43, width=80, height=25, mask="auto", preserveAspectRatio=True, anchor="c")
    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    main()

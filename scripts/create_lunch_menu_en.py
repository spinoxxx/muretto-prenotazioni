from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import portrait
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "menu-del-pranzo-en.pdf"
LOGO = ROOT / "public" / "muretto-logo.png"

PAGE_WIDTH, PAGE_HEIGHT = 679, 925
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
        pdf.drawImage(str(LOGO), 261, 786, width=157, height=43, mask="auto", preserveAspectRatio=True, anchor="c")
    center_text(pdf, "TASTE THE MOMENT.", 777, "Helvetica", 5.5, MUTED)
    center_text(pdf, "DAILY MENU", 725, "Times-Roman", 27, GREEN)

    center_text(pdf, "FIRST COURSE OF YOUR CHOICE", 643, "Times-Roman", 17, GREEN)
    fit_centered_text(pdf, "PENNE WITH TOMATO SAUCE, FRESH BUFFALO MOZZARELLA AND BASIL  (1, 7)", 604, "Helvetica", 10.5, 520)
    center_text(pdf, "PENNE ALLA NORMA  (1, 7)", 574, "Helvetica", 10.5)
    center_text(pdf, "VENERE RICE SALAD WITH TUNA, OLIVES AND CAPERS", 544, "Helvetica", 10.5)

    center_text(pdf, "MAIN COURSE OF YOUR CHOICE", 482, "Times-Roman", 17, GREEN)
    center_text(pdf, "LEMON ESCALOPES WITH A SIDE DISH  (1)", 439, "Helvetica", 10.5)
    center_text(pdf, "OVEN-BAKED SALMON WITH A SIDE DISH", 409, "Helvetica", 10.5)
    center_text(pdf, "POLENTA WITH SAUSAGE", 379, "Helvetica", 10.5)

    pdf.setFillColor(TEXT)
    pdf.setFont("Helvetica", 9.5)
    pdf.drawString(94, 334, "SIDE DISHES OF YOUR CHOICE:")
    pdf.drawString(94, 320, "OVEN-BAKED POTATOES OR VEGETABLE RATATOUILLE")

    pdf.setFillColor(GREEN)
    pdf.rect(99, 160, 481, 122, fill=1, stroke=0)
    center_text(pdf, "ONE COURSE", 238, "Times-Roman", 17, white)
    center_text(pdf, "TWO COURSES", 197, "Times-Roman", 17, white)
    pdf.setFont("Times-Bold", 15)
    pdf.setFillColor(white)
    pdf.drawString(424, 238, "€14")
    pdf.drawString(424, 197, "€20")
    pdf.setFont("Helvetica", 8.5)
    pdf.drawString(224, 175, "water, coffee and cover charge included")

    pdf.setFillColor(MUTED)
    pdf.setFont("Helvetica", 7.2)
    footer_left = [
        "* Products marked with an asterisk may have been previously frozen",
        "after blast chilling. Dishes may contain traces of allergens",
        "due to cross-contamination.",
    ]
    for index, line in enumerate(footer_left):
        pdf.drawString(99, 83 - index * 10, line)
    pdf.setFont("Helvetica", 7)
    allergens = [
        "1 gluten · 2 crustaceans", "9 celery · 10 mustard",
        "3 eggs · 4 fish", "11 sesame seeds",
        "5 peanuts · 6 soy", "12 sulphur dioxide",
        "7 milk · 8 nuts", "13 lupin · 14 molluscs",
    ]
    for index, line in enumerate(allergens):
        x = 420 if index % 2 == 0 else 530
        y = 83 - (index // 2) * 10
        pdf.drawString(x, y, line)

    if LOGO.exists():
        pdf.drawImage(str(LOGO), 300, 43, width=80, height=25, mask="auto", preserveAspectRatio=True, anchor="c")
    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    main()

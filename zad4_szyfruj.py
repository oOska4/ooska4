alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

try:
    with open('perm.txt', 'r') as f:
        key = f.read().strip()
except FileNotFoundError:
    print("Error: nie znaleziono pliku perm.txt.")
    exit()

try:
    with open('tekst2.txt', 'r', encoding='utf-8') as f:
        text = f.read().upper()
except FileNotFoundError:
    print("Error: nie znaleziono pliku tekst2.txt.")
    exit()

table = str.maketrans(alphabet, key)
encrypted = text.translate(table)

with open('zad4_wyn.txt', 'w', encoding='utf-8') as f:
    f.write(encrypted)

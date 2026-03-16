alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

try:
    with open('perm.txt', 'r') as f:
        key = f.read().strip()
except FileNotFoundError:
    print("Error: Nie znaleziono perm.txt.")
    exit()

try:
    with open('zad4_wyn.txt', 'r', encoding='utf-8') as f:
        text = f.read()
except FileNotFoundError:
    print("Error: Nie znaleziono zad4_wyn.txt.")
    exit()

table = str.maketrans(key, alphabet)
decrypted = text.translate(table)

with open('zad4_wyn2.txt', 'w', encoding='utf-8') as f:
    f.write(decrypted)

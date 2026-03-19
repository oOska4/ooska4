with open("liczby.txt", "r") as plik:
    liczby = [int(linia.strip()) for linia in plik]

szukana = int(input("Podaj liczbę do wyszukania: "))

pozycja = -1

for i in range(len(liczby)):
    if liczby[i] == szukana:
        pozycja = i  # indeks (od 0)
        break

print(pozycja)
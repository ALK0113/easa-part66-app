import pandas as pd
import openpyxl

def load_students_from_excel(file_path):
    # Leer el archivo Excel
    df = pd.read_excel(file_path)
    
    # Asegurarse de que las columnas estén presentes
    required_columns = ['Promoción', 'Curso', 'Clase', 'Nombre del Alumno']
    if not all(col in df.columns for col in required_columns):
        raise ValueError("El archivo Excel no contiene todas las columnas necesarias.")
    
    # Procesar los datos y guardar en la base de datos o en otro lugar
    for index, row in df.iterrows():
        promotion = row['Promoción']
        course = row['Curso']
        class_name = row['Clase']
        student_name = row['Nombre del Alumno']
        
        # Aquí puedes agregar tu lógica para guardar los datos en la base de datos o en otro lugar
        print(f"Alumno: {student_name}, Promoción: {promotion}, Curso: {course}, Clase: {class_name}")

# Ejemplo de uso
if __name__ == "__main__":
    file_path = "path/to/alumnos_template.xlsx"
    load_students_from_excel(file_path)
    load_students_from_excel(file_path)

python src/main.py

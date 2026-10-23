insert into public.modules (id, name, description, color)
values
  ('M01', 'Mathematics', 'Matemáticas: aritmética, álgebra, geometría y trigonometría.', 1),
  ('M02', 'Physics', 'Física: mecánica, termodinámica, óptica y electricidad básica.', 2),
  ('M03', 'Electrical Fundamentals', 'Fundamentos eléctricos, circuitos, baterías y generación.', 3),
  ('M04', 'Electronic Fundamentals', 'Fundamentos electrónicos, semiconductores y circuitos.', 4),
  ('M05', 'Digital Techniques / Electronic Instrument Systems', 'Técnicas digitales, buses y sistemas electrónicos de instrumentos.', 5),
  ('M06', 'Materials and Hardware', 'Materiales aeronáuticos, procesos y elementos de fijación.', 6),
  ('M07', 'Maintenance Practices', 'Prácticas de mantenimiento, herramientas, inspección y seguridad.', 7),
  ('M08', 'Basic Aerodynamics', 'Principios de aerodinámica y teoría del vuelo.', 8),
  ('M09', 'Human Factors', 'Factores humanos, rendimiento y seguridad operacional.', 9),
  ('M10', 'Aviation Legislation', 'Legislación aeronáutica, EASA, Part-145 y Part-66.', 10),
  ('M11', 'Turbine Aeroplane Aerodynamics, Structures and Systems (M11A)', 'Aeronaves de turbina: aerodinámica, estructuras y sistemas. El identificador interno M11 se conserva por compatibilidad.', 11),
  ('M11B', 'Piston Aeroplane Aerodynamics, Structures and Systems', 'Aeronaves de pistón: aerodinámica, estructuras y sistemas.', 12),
  ('M12', 'Helicopter Aerodynamics, Structures and Systems', 'Helicópteros: aerodinámica, estructuras y sistemas.', 13),
  ('M13', 'Aircraft Aerodynamics, Structures and Systems', 'Aerodinámica, estructuras y sistemas de aeronaves.', 14),
  ('M14', 'Propulsion', 'Fundamentos de propulsión aeronáutica.', 15),
  ('M15', 'Gas Turbine Engine', 'Motores de turbina de gas y sus sistemas.', 16),
  ('M16', 'Piston Engine', 'Motores alternativos de pistón y sus sistemas.', 17),
  ('M17', 'Propeller', 'Hélices, mandos y sistemas asociados.', 18)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    color = excluded.color;
-- Un correo = una sola cuenta, sin distinguir mayúsculas (auth.users ya lo garantiza;
-- profiles lo refuerza para cualquier vía de alta).
create unique index if not exists profiles_email_lower_key on public.profiles (lower(email));

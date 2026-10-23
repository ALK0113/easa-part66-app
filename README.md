# AviaTrack · EASA Part 66

Aplicación React/Vite para la gestión académica EASA Part 66. Supabase proporciona autenticación y persistencia; los roles se leen de `profiles` (`admin`, `profesor`, `alumno`).

## Desarrollo

```sh
npm install
npm run dev
```

Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env`. Nunca incluyas la clave `service_role` en variables `VITE_*` ni en el cliente.

## Activar gestión completa

Las migraciones añaden vínculos alumno-cuenta, matrículas, asistencia, políticas RLS, restricciones referenciales seguras, índices de consulta y publicación Realtime. Las escrituras de varias tablas (alta/edición de alumnos, asignaciones, creación de TLB y restauración de backups) se hacen mediante RPC transaccionales; la sincronización en vivo requiere publicar las tablas en `supabase_realtime`. Vincula el proyecto Supabase y aplica ambas migraciones:

```sh
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase db push
```

La invitación de alumnos/profesores requiere desplegar la Edge Function segura `admin-create-user`:

```sh
npx supabase functions deploy admin-create-user
```

La función exige JWT válido y rol `admin`; usa `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en el entorno servidor administrado por Supabase. En Supabase Auth, configura las URL locales y de producción permitidas para confirmación e invitaciones.

La importación de backup es de inserción segura: añade filas faltantes y no sobrescribe las existentes. Las copias exportadas no incluyen credenciales Auth. Programa también backups automáticos del proyecto Supabase desde su panel; una exportación de la app no sustituye una copia física administrada del servidor.

Sin aplicar las migraciones y desplegar la función, la app puede compilar y autenticar, pero transacciones, matrículas, asistencia y sincronización Realtime no estarán activas.

## Comprobaciones

```sh
npm run lint
npm run build
```
# ЛИНИЯ — GitHub Pages + Supabase

Веб-мессенджер без собственного постоянно включённого устройства.

## Что уже есть

- регистрация и вход через Supabase Auth;
- личные диалоги и realtime-сообщения;
- поиск пользователей;
- 6 тем оформления;
- адаптивный интерфейс для телефона и ПК;
- PostgreSQL + RLS;
- отдельный **неизменяемый владелец** (`app_owner`);
- админ-панель владельца;
- бан/разбан пользователей;
- удаление сообщений и диалогов через защищённые admin RPC;
- удаление аккаунта через Supabase Edge Function.

## Самое важное: как сделать, чтобы админом был только ты

1. Создай **свой аккаунт первым** на сайте.
2. В Supabase открой SQL Editor и выполни `schema.sql`.
3. В самом низу `schema.sql` есть блок:

```sql
insert into public.app_owner(singleton, owner_user_id)
select true, id from auth.users where lower(email)=lower('YOUR_EMAIL')
on conflict (singleton) do nothing;
```

4. Замени `YOUR_EMAIL` на email **своего аккаунта** и выполни этот запрос.
5. Проверка:

```sql
select p.email, o.owner_user_id
from public.app_owner o
join auth.users p on p.id=o.owner_user_id;
```

После этого запись владельца хранит именно UUID твоего аккаунта. **Другой пользователь не может через сайт назначить себя админом, поменять владельца или удалить владельца.** Владелец не может сам себя заблокировать из админки.

> Не пытайся делать проверку админа только через `localStorage`, HTML или JavaScript. В этом проекте права проверяются на стороне Supabase через RLS/SQL, а опасные действия дополнительно проверяет Edge Function.

## Edge Function для полного админ-контроля

Файл находится в:

`supabase/functions/admin-action/index.ts`

Она нужна для операций, которые требуют `service_role`, например полного удаления аккаунта из Supabase Auth. **Service role key никогда не помещается в `config.js` и не отправляется в GitHub Pages.**

Разверни функцию в своём Supabase-проекте через Supabase CLI:

```bash
supabase functions deploy admin-action
```

Локально для проекта также можно использовать:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-action
```

После публикации кнопка «Удалить» в админке сможет удалять аккаунт полностью.

## GitHub Pages

Загрузи содержимое папки `messenger-github` в GitHub-репозиторий. Workflow уже находится в `.github/workflows/pages.yml`.

В `config.js` указываются только:

- Supabase Project URL;
- Supabase publishable/anon key.

**Никогда не добавляй service_role key в `config.js`.**


## Голосовые сообщения
В чатах есть отдельная кнопка 🎙. Нажми её для записи и нажми ещё раз для отправки. При первом использовании браузер попросит доступ к микрофону.
Перед первым запуском заново выполни обновлённый `schema.sql` в Supabase: он создаёт поля `message_type/media_url/duration` и bucket `voice-messages`.

## Настройки
Настройки вынесены в отдельную кнопку «⚙ Настройки» в нижней части левой панели. Админская кнопка ♛ остаётся отдельно и показывается только владельцу.

-- Agents with a random identity keep it, except the `surprised` eyes: they look
-- shocked and have the narrowest pupil in the catalog. Automatic assignment
-- skips them too (ASSIGNED_EYE_STYLES). Bots are left alone, since their face is
-- the user's choice and their agents follow them.
select set_config('anu.scope', 'system', true);
update agents set eye_style = 'gentle' where eye_style = 'surprised' and bot_id is null;

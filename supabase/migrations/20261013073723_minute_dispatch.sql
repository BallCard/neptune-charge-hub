-- Calls the protected dispatcher; its runtime switch starts disabled.
select cron.schedule('neptune-charge-web-minute','* * * * *','select public.web_cron_trigger();');

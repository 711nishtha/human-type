-- Sample SQL fixture with a line comment.
/* And a block comment
   across two lines. */
SELECT
    u.id,
    u.name,          -- the display name
    COUNT(o.id) AS order_count
FROM users AS u
LEFT JOIN orders AS o ON o.user_id = u.id
WHERE u.name = 'O''Brien'
  AND u.created_at >= '2024-01-01'
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 0
ORDER BY order_count DESC
LIMIT 10;

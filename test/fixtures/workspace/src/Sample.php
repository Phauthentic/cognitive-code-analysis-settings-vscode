<?php

declare(strict_types=1);

final class Sample
{
    public function simple(int $a, int $b): int
    {
        return $a + $b;
    }

    public function complex(array $items, int $limit): array
    {
        $result = [];
        foreach ($items as $item) {
            if ($item > $limit) {
                if ($item % 2 === 0) {
                    $result[] = $item;
                } else {
                    $result[] = $item + 1;
                }
            } elseif ($item < 0) {
                $result[] = 0;
            } else {
                foreach ($items as $other) {
                    if ($other === $item) {
                        $result[] = $other;
                    }
                }
            }
        }

        return $result;
    }
}

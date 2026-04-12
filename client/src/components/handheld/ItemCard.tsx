
import { PickingItem } from "@/lib/pickingStore";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, SkipForward, AlertTriangle } from "lucide-react";

interface ItemCardProps {
    item: PickingItem;
    onConfirm: (qty: number) => void;
    onSkip: () => void;
    onIssue: () => void;
}

export function ItemCard({ item, onConfirm, onSkip, onIssue }: ItemCardProps) {
    return (
        <Card className="w-full max-w-full mx-0 shadow-lg border-2 overflow-hidden">
            <CardHeader className="pb-2">
                <div className="flex justify-between items-start gap-2">
                    <Badge variant="outline" className="text-sm shrink-0 max-w-[50%] truncate">
                        {item.section}
                    </Badge>
                    <Badge variant={item.statusLocal === 'picked' ? "default" : "secondary"} className="shrink-0">
                        {item.statusLocal === 'picked' ? 'Separado' : 'Pendente'}
                    </Badge>
                </div>
                <CardTitle className="text-xl mt-2 line-clamp-2 leading-tight break-words">
                    {item.product.name}
                </CardTitle>
                <div className="text-muted-foreground text-sm font-mono mt-1 truncate">
                    EAN: {item.product.barcode || "SEM CÓDIGO"}
                </div>
            </CardHeader>

            <CardContent className="py-4 flex flex-col items-center space-y-4">
                <div className="w-28 h-28 bg-muted rounded-md flex items-center justify-center text-muted-foreground shrink-0">
                    <span className="text-xs">Sem Imagem</span>
                </div>

                <div className="flex items-baseline space-x-2">
                    <span className="text-5xl font-bold tracking-tighter">
                        {item.quantity - (item.qtyPicked || 0)}
                    </span>
                    <span className="text-xl text-muted-foreground font-medium">
                        {item.product.unit}
                    </span>
                </div>
                <p className="text-sm text-muted-foreground">Quantidade a separar</p>
            </CardContent>

            <CardFooter className="flex flex-col gap-3 pt-2">
                <Button
                    className="w-full h-14 text-lg font-bold bg-green-600 hover:bg-green-700"
                    onClick={() => onConfirm(item.quantity)}
                >
                    <Check className="mr-2 h-6 w-6" />
                    CONFIRMAR
                </Button>

                <div className="grid grid-cols-2 gap-3 w-full">
                    <Button variant="outline" className="h-12" onClick={onSkip}>
                        <SkipForward className="mr-2 h-4 w-4" />
                        Pular
                    </Button>
                    <Button variant="destructive" className="h-12" onClick={onIssue}>
                        <AlertTriangle className="mr-2 h-4 w-4" />
                        Avaria/Falta
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}

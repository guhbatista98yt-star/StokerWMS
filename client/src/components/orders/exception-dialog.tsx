import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel,
    AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
    AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { AlertTriangle } from "lucide-react";
import type { ExceptionType } from "@shared/schema";

interface ExceptionDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    productName: string;
    maxQuantity: number;
    hasExceptions?: boolean;
    onSubmit: (data: {
        type: ExceptionType;
        quantity: number;
        observation: string;
    }) => void;
    onClearExceptions?: () => void;
    isSubmitting?: boolean;
    isClearing?: boolean;
}

const exceptionTypeLabels: Record<ExceptionType, string> = {
    nao_encontrado: "Não Encontrado",
    avariado: "Avariado",
    vencido: "Vencido",
};

export function ExceptionDialog({
    open,
    onOpenChange,
    productName,
    maxQuantity,
    hasExceptions = false,
    onSubmit,
    onClearExceptions,
    isSubmitting = false,
    isClearing = false,
}: ExceptionDialogProps) {
    const [type, setType] = useState<ExceptionType | "">("");
    const [quantity, setQuantity] = useState("1");
    const [observation, setObservation] = useState("");
    const [showClearConfirm, setShowClearConfirm] = useState(false);

    const handleSubmit = () => {
        if (!type) return;

        onSubmit({
            type: type as ExceptionType,
            quantity: Number(quantity),
            observation,
        });

        // Reset form
        setType("");
        setQuantity("1");
        setObservation("");
    };

    const handleCancel = () => {
        setType("");
        setQuantity("1");
        setObservation("");
        onOpenChange(false);
    };

    const handleClear = () => {
        if (onClearExceptions) {
            setShowClearConfirm(true);
        }
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                            <AlertTriangle className="h-5 w-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <div>
                            <DialogTitle>Relatar Problema</DialogTitle>
                            <DialogDescription>{productName}</DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                        <Label htmlFor="exception-type">Tipo de Problema *</Label>
                        <Select value={type} onValueChange={(value) => setType(value as ExceptionType)}>
                            <SelectTrigger id="exception-type">
                                <SelectValue placeholder="Selecione o tipo" />
                            </SelectTrigger>
                            <SelectContent>
                                {Object.entries(exceptionTypeLabels).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="quantity">Quantidade Afetada *</Label>
                        <Input
                            id="quantity"
                            type="number"
                            min="1"
                            max={maxQuantity}
                            value={quantity}
                            onChange={(e) => setQuantity(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            Máximo: {maxQuantity}
                        </p>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="observation">Observação</Label>
                        <Textarea
                            id="observation"
                            placeholder="Descreva o problema encontrado..."
                            value={observation}
                            onChange={(e) => setObservation(e.target.value)}
                            rows={3}
                        />
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    {hasExceptions && onClearExceptions && (
                        <Button
                            variant="destructive"
                            onClick={handleClear}
                            disabled={isSubmitting || isClearing}
                            className="sm:mr-auto"
                        >
                            {isClearing ? "Limpando..." : "Limpar Problemas"}
                        </Button>
                    )}
                    <div className="flex gap-2 sm:ml-auto">
                        <Button
                            variant="outline"
                            onClick={handleCancel}
                            disabled={isSubmitting || isClearing}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={!type || !quantity || isSubmitting || isClearing}
                        >
                            {isSubmitting ? "Salvando..." : "Confirmar"}
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>

        <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Limpar problemas</AlertDialogTitle>
                    <AlertDialogDescription>
                        Tem certeza que deseja limpar todos os problemas relatados de <strong>{productName}</strong>?
                        Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        className="bg-red-600 hover:bg-red-700"
                        onClick={() => {
                            onClearExceptions?.();
                            setShowClearConfirm(false);
                        }}
                        data-testid="btn-confirm-clear-exceptions"
                    >
                        Limpar
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    );
}

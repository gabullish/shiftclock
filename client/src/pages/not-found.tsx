import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6">
          <div className="flex mb-4 gap-2 items-center">
            <AlertCircle className="h-7 w-7 text-destructive shrink-0" />
            <h1 className="text-2xl font-bold text-foreground">Page not found</h1>
          </div>

          <p className="mt-2 text-sm text-muted-foreground">
            That page doesn't exist. It may have moved, or the link was mistyped.
          </p>

          <Link href="/">
            <Button className="mt-5 w-full">Back to dashboard</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

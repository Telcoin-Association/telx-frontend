import React from "react";
import { deepEqual } from "wagmi";

export type SkrimOption = {
    name: string,
    href?: string,
    action?: any,
    icon: string,
}

export const useSkrim = () => {
    const [skrim, setSkrim] = React.useState(false)
    const [content, setContent] = React.useState<any>(null)
    const [onEnter, setOnEnter] = React.useState<any>(false)
    const setOnEnterRef = React.useRef(setOnEnter)

    React.useEffect(() => {
        setTimeout(() => {
            setOnEnterRef.current(skrim)
        }, 100)
    }, [skrim])

    const clear = () => {
        setSkrim(false)
        setContent(null)
    }

    const set = (payload: any) => {
        if (payload && deepEqual(payload, content)){
            clear()
        } else {
            setSkrim(true)
            setContent(payload)
        }
    }

    return { skrim, set, clear, content, onEnter }
}
